import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMatchToAggregate: vi.fn(),
  appendUserPublicMatch: vi.fn(),
  ensureUserProfile: vi.fn(),
  identityUidsFor: vi.fn(),
  invalidateCommunityMatchMemoryCache: vi.fn(),
  normalizeMatch: vi.fn(),
  requireUser: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

vi.mock("@/lib/community/data", () => ({
  appendMatchToAggregate: mocks.appendMatchToAggregate,
  invalidateCommunityMatchMemoryCache: mocks.invalidateCommunityMatchMemoryCache,
  normalizeMatch: mocks.normalizeMatch,
}));

vi.mock("@/lib/social/server", () => ({
  appendUserPublicMatch: mocks.appendUserPublicMatch,
  bestProfileDisplayName: () => "Canonical Player",
  ensureUserProfile: mocks.ensureUserProfile,
  identityUidsFor: mocks.identityUidsFor,
  requireUser: mocks.requireUser,
}));

import { POST } from "@/app/api/community/aggregate/append/route";

describe("community aggregate append identity ownership", () => {
  let storedMatch: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    storedMatch = { uid: "desktop-alias", result: "Win" };
    mocks.requireUser.mockResolvedValue({
      db: {
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ ...storedMatch }),
            }),
          }),
        }),
      },
      authenticatedUid: "desktop-alias",
      decoded: { uid: "account-canonical", name: "Player", email: "player@example.com" },
    });
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "desktop-alias"]);
    mocks.ensureUserProfile.mockResolvedValue({ handle: "player", displayName: "Canonical Player" });
    mocks.normalizeMatch.mockImplementation((id: string, match: Record<string, unknown>) => ({ id, ...match }));
    mocks.appendMatchToAggregate.mockResolvedValue({ appended: true });
    mocks.appendUserPublicMatch.mockResolvedValue(undefined);
  });

  it("accepts a proven desktop alias but stores the report under the canonical account", async () => {
    const response = await POST(request({ id: "match-1", match: { uid: "desktop-alias", result: "Loss" } }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected an aggregate append response.");
    expect(response.status).toBe(200);
    expect(mocks.normalizeMatch).toHaveBeenCalledWith("match-1", expect.objectContaining({
      uid: "account-canonical",
      owner_uid: "account-canonical",
      result: "Win",
    }));
    expect(mocks.appendMatchToAggregate).toHaveBeenCalledWith(expect.objectContaining({
      uid: "account-canonical",
    }));
    expect(mocks.appendUserPublicMatch).toHaveBeenCalledOnce();
  });

  it("rejects a report owned by an unrelated identity", async () => {
    storedMatch = { uid: "another-account", result: "Win" };
    const response = await POST(request({ id: "match-1", match: { uid: "another-account" } }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected an aggregate append response.");
    expect(response.status).toBe(403);
    expect(mocks.normalizeMatch).not.toHaveBeenCalled();
    expect(mocks.appendMatchToAggregate).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/community/aggregate/append", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
