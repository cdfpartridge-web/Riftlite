import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUserProfile: vi.fn(),
  findMembershipDocuments: vi.fn(),
  identityUidsFor: vi.fn(),
  linkedReplayUid: vi.fn(),
  repairHistoricalDesktopIdentityAssociations: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: mocks.linkedReplayUid,
}));

vi.mock("@/lib/social/hub-lifecycle", () => ({
  primaryOwnerUid: (hub: Record<string, unknown>) =>
    String(hub.owner_uid ?? hub.ownerUid ?? hub.created_by ?? hub.createdBy ?? "").trim(),
}));

vi.mock("@/lib/social/server", () => ({
  bestProfileDisplayName: vi.fn(),
  ensureUserProfile: mocks.ensureUserProfile,
  findMembershipDocuments: mocks.findMembershipDocuments,
  hubIdFromName: vi.fn(),
  identityUidsFor: mocks.identityUidsFor,
  profileIsComplete: () => true,
  repairHistoricalDesktopIdentityAssociations: mocks.repairHistoricalDesktopIdentityAssociations,
  requireUser: mocks.requireUser,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import { GET } from "@/app/api/hubs/route";

describe("private hub account discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureUserProfile.mockResolvedValue({ uid: "account-uid", handle: "player", displayName: "Player" });
    mocks.findMembershipDocuments.mockResolvedValue([]);
    mocks.identityUidsFor.mockResolvedValue(["account-uid", "desktop-uid"]);
    mocks.linkedReplayUid.mockReturnValue("account-uid");
    mocks.repairHistoricalDesktopIdentityAssociations.mockResolvedValue([]);
  });

  it("rediscovers a password-only hub created by a linked desktop identity", async () => {
    const fake = fakeHubDatabase({
      "legacy-hub": {
        name: "Legacy Hub",
        created_by: "desktop-uid",
        password_hash: "a".repeat(64),
        created_at: 1_700_000_000,
      },
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      hubs: [{
        id: "legacy-hub",
        name: "Legacy Hub",
        role: "owner",
        claimed: false,
      }],
    });
  });

  it("reports account-managed hubs as claimed and ignores a stale creator", async () => {
    const fake = fakeHubDatabase({
      "claimed-hub": {
        name: "Claimed Hub",
        owner_uid: "account-uid",
        created_by: "account-uid",
        role_mode: "account",
      },
      "not-owned-anymore": {
        name: "Transferred Hub",
        owner_uid: "current-owner",
        created_by: "desktop-uid",
        role_mode: "account",
      },
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));

    const response = await GET(request());
    const body = await response.json() as { hubs: Array<Record<string, unknown>> };

    expect(body.hubs).toEqual([expect.objectContaining({
      id: "claimed-hub",
      role: "owner",
      claimed: true,
    })]);
  });
});

function request(): NextRequest {
  return new NextRequest("http://localhost/api/hubs", {
    headers: { authorization: "Bearer token" },
  });
}

function auth(db: ReturnType<typeof fakeHubDatabase>["db"]) {
  return {
    db,
    decoded: { uid: "account-uid", email: "player@example.com" },
  };
}

function fakeHubDatabase(hubs: Record<string, Record<string, unknown>>) {
  type Ref = { id: string; path: string };
  const refs = new Map<string, Ref>();
  const ref = (id: string): Ref => {
    const existing = refs.get(id);
    if (existing) return existing;
    const created = { id, path: `hubs/${id}` };
    refs.set(id, created);
    return created;
  };
  const snapshot = (id: string) => ({
    id,
    ref: ref(id),
    exists: Boolean(hubs[id]),
    data: () => hubs[id] ? { ...hubs[id] } : undefined,
  });
  const db = {
    collection: (name: string) => {
      if (name !== "hubs") throw new Error(`Unexpected collection ${name}`);
      return {
        where: (field: string, operator: string, value: unknown) => ({
          get: async () => ({
            docs: operator === "=="
              ? Object.keys(hubs).filter((id) => hubs[id][field] === value).map(snapshot)
              : [],
          }),
        }),
      };
    },
    getAll: async (...documents: Ref[]) => documents.map((document) => snapshot(document.id)),
  };
  return { db };
}
