import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  identityUidsFor: vi.fn(),
  linkedReplayUid: vi.fn(),
  readBoundedJson: vi.fn(),
  putHubWebReplay: vi.fn(),
  deleteHubWebReplay: vi.fn(),
}));

vi.mock("@/lib/social/server", () => ({
  requireUser: mocks.requireUser,
  identityUidsFor: mocks.identityUidsFor,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: mocks.linkedReplayUid,
}));

vi.mock("@/lib/replay-v2-server", () => ({
  MAX_VISIBILITY_JSON_BYTES: 8_192,
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
    mocks.requireUser.mockResolvedValue({
      db: { id: "db" },
      decoded: { uid: "account-uid", riftlite_linked_account: true },
    });
    mocks.linkedReplayUid.mockReturnValue("account-uid");
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

  it("rejects anonymous-style Firebase identities before any grant lookup", async () => {
    mocks.linkedReplayUid.mockReturnValue("");

    const response = (await linkWebReplay(request("PUT", { replayId: REPLAY_ID }), context()))!;

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "authentication_required" });
    expect(mocks.putHubWebReplay).not.toHaveBeenCalled();
  });
});

function request(method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/hubs/hub-a/matches/match-a/web-replay", {
    method,
    headers: { authorization: "Bearer token", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context() {
  return { params: Promise.resolve({ hubId: "hub-a", matchId: "match-a" }) };
}
