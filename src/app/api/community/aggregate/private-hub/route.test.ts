import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHubCapability: vi.fn(),
  identityUidsFor: vi.fn(),
  recordPrivateHubAggregateEvent: vi.fn(),
  requireUser: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

vi.mock("@/lib/community/data", () => ({
  PrivateHubAggregateEventError: class PrivateHubAggregateEventError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  recordPrivateHubAggregateEvent: mocks.recordPrivateHubAggregateEvent,
}));

vi.mock("@/lib/social/server", () => ({
  assertHubCapability: mocks.assertHubCapability,
  identityUidsFor: mocks.identityUidsFor,
  requireUser: mocks.requireUser,
}));

import { POST } from "@/app/api/community/aggregate/private-hub/route";

describe("private-hub aggregate route identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-alias",
      decoded: { uid: "account-canonical" },
      db: {
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({ role_mode: "account" }) }),
          }),
        }),
      },
    });
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "desktop-alias"]);
    mocks.assertHubCapability.mockResolvedValue("member");
    mocks.recordPrivateHubAggregateEvent.mockResolvedValue({
      privateMatchCount: 1,
      privatePlayerCount: 1,
    });
  });

  it("accepts a proven desktop alias but records the canonical account", async () => {
    const response = await POST(request({
      action: "upsert",
      hubId: "hub-a",
      matchId: "match-a",
      uid: "desktop-alias",
    }));

    if (!response) throw new Error("Expected a private-hub aggregate response.");
    expect(response.status).toBe(200);
    expect(mocks.assertHubCapability).toHaveBeenCalledWith("hub-a", "account-canonical", "participate");
    expect(mocks.recordPrivateHubAggregateEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "upsert",
      uid: "account-canonical",
      identityUids: ["account-canonical", "desktop-alias"],
    }));
  });

  it("rejects an unrelated body uid before touching aggregate state", async () => {
    const response = await POST(request({
      action: "delete",
      hubId: "hub-a",
      matchId: "match-a",
      uid: "another-account",
    }));

    if (!response) throw new Error("Expected a private-hub aggregate response.");
    expect(response.status).toBe(403);
    expect(mocks.recordPrivateHubAggregateEvent).not.toHaveBeenCalled();
  });

  it("rejects unknown actions and malformed document ids", async () => {
    const badAction = await POST(request({ action: "remove", hubId: "hub-a", matchId: "match-a" }));
    const badPath = await POST(request({ action: "delete", hubId: "hub-a/other", matchId: "match-a" }));

    if (!badAction || !badPath) throw new Error("Expected private-hub aggregate responses.");
    expect(badAction.status).toBe(400);
    expect(badPath.status).toBe(400);
    expect(mocks.recordPrivateHubAggregateEvent).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/community/aggregate/private-hub", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
