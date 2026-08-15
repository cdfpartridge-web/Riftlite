import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ReplayV2Error extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ReplayV2Error,
    getFirestoreAdmin: vi.fn(),
    identityUidsFor: vi.fn(),
    requireFirebaseBearerUser: vi.fn(),
    readBoundedJson: vi.fn(),
    putHubWebReplay: vi.fn(),
    deleteHubWebReplay: vi.fn(),
  };
});

vi.mock("@/lib/social/server", () => ({
  identityUidsFor: mocks.identityUidsFor,
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

vi.mock("@/lib/replay-v2-server", () => ({
  MAX_VISIBILITY_JSON_BYTES: 8_192,
  ReplayV2Error: mocks.ReplayV2Error,
  requireFirebaseBearerUser: mocks.requireFirebaseBearerUser,
  readBoundedJson: mocks.readBoundedJson,
  putHubWebReplay: mocks.putHubWebReplay,
  deleteHubWebReplay: mocks.deleteHubWebReplay,
  noStoreJson: (body: unknown, status = 200) => Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  }),
  replayApiError: (error: unknown) => {
    const typed = error as { message?: string; code?: string; status?: number };
    return Response.json(
      { error: typed.message ?? "Replay request failed.", code: typed.code ?? "internal_error" },
      { status: typed.status ?? 500 },
    );
  },
}));

import {
  DELETE as unlinkWebReplay,
  PUT as linkWebReplay,
} from "@/app/api/hubs/[hubId]/matches/[matchId]/web-replay/route";

const REPLAY_ID = `rl2_${"e".repeat(32)}`;

describe("private-hub Web Replay route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirestoreAdmin.mockReturnValue({ id: "db" });
    mocks.requireFirebaseBearerUser.mockResolvedValue("account-uid");
    mocks.identityUidsFor.mockResolvedValue(["account-uid", "desktop-uid"]);
    mocks.readBoundedJson.mockResolvedValue({ replayId: REPLAY_ID });
  });

  it("passes canonical aliases into the atomic PUT and returns the player path", async () => {
    mocks.putHubWebReplay.mockResolvedValue({
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
    });

    const response = (await linkWebReplay(request("PUT", { replayId: REPLAY_ID }), context()))!;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      playerPath: `/replays/${REPLAY_ID}`,
    });
    expect(mocks.putHubWebReplay).toHaveBeenCalledWith(
      { id: "db" },
      {
        hubId: "hub-a",
        matchId: "match-a",
        replayId: REPLAY_ID,
        actorUid: "account-uid",
        identityUids: ["account-uid", "desktop-uid"],
      },
    );
  });

  it("uses the same identity and match contract for DELETE", async () => {
    mocks.deleteHubWebReplay.mockResolvedValue({
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
      unlinked: true,
      alreadyUnlinked: false,
    });

    const response = (await unlinkWebReplay(request("DELETE"), context()))!;

    expect(await response.json()).toMatchObject({ ok: true, unlinked: true });
    expect(mocks.deleteHubWebReplay).toHaveBeenCalledWith(
      { id: "db" },
      {
        hubId: "hub-a",
        matchId: "match-a",
        actorUid: "account-uid",
        identityUids: ["account-uid", "desktop-uid"],
      },
    );
  });

  it("verifies an untouched historical-alias bearer through the shared Replay V2 verifier", async () => {
    mocks.requireFirebaseBearerUser.mockResolvedValue("account-uid");
    mocks.putHubWebReplay.mockResolvedValue({
      hubId: "hub-a",
      matchId: "match-a",
      replayId: REPLAY_ID,
    });

    const aliasRequest = request("PUT", { replayId: REPLAY_ID }, "historical-alias-token");
    const response = (await linkWebReplay(aliasRequest, context()))!;

    expect(response.status).toBe(200);
    expect(mocks.requireFirebaseBearerUser).toHaveBeenCalledWith(aliasRequest);
    expect(aliasRequest.headers.get("authorization")).toBe("Bearer historical-alias-token");
    expect(mocks.putHubWebReplay).toHaveBeenCalledOnce();
  });

  it("rejects identities that the shared recoverable-account verifier rejects", async () => {
    mocks.requireFirebaseBearerUser.mockRejectedValue({
      status: 401,
      code: "authentication_required",
      message: "A linked RiftLite account token is required.",
    });

    const response = (await linkWebReplay(request("PUT", { replayId: REPLAY_ID }), context()))!;

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "authentication_required" });
    expect(mocks.putHubWebReplay).not.toHaveBeenCalled();
  });

  it.each([
    "account_hub_required",
    "hub_deleting",
    "replay_match_mismatch",
  ])("acknowledges terminal %s attachments without claiming a link was created", async (code) => {
    mocks.putHubWebReplay.mockRejectedValue(new mocks.ReplayV2Error(
      409,
      code,
      "This attachment cannot be created.",
    ));

    const response = (await linkWebReplay(request("PUT", { replayId: REPLAY_ID }), context()))!;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      linked: false,
      skipped: true,
      reason: code,
      message: "This attachment cannot be created.",
    });
  });

  it("keeps a not-yet-ready replay retryable instead of acknowledging a false link", async () => {
    mocks.putHubWebReplay.mockRejectedValue(new mocks.ReplayV2Error(
      409,
      "replay_not_ready",
      "Web Replay processing must finish before it can be attached.",
    ));

    const response = (await linkWebReplay(request("PUT", { replayId: REPLAY_ID }), context()))!;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "replay_not_ready" });
  });
});

function request(method: string, body?: Record<string, unknown>, token = "token"): NextRequest {
  return new NextRequest("http://localhost/api/hubs/hub-a/matches/match-a/web-replay", {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context() {
  return { params: Promise.resolve({ hubId: "hub-a", matchId: "match-a" }) };
}
