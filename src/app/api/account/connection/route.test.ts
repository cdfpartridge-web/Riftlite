import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  associateLinkedIdentity: vi.fn(),
  canonicalIdentityUid: vi.fn(),
  createFirebaseCustomToken: vi.fn(),
  ensureUserProfile: vi.fn(),
  identityUidsFor: vi.fn(),
  linkedReplayUid: vi.fn(),
  repairHistoricalDesktopIdentityAssociations: vi.fn(),
  requireUser: vi.fn(),
  LinkedIdentityConflictError: class LinkedIdentityConflictError extends Error {},
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseCustomToken: mocks.createFirebaseCustomToken,
}));

vi.mock("@/lib/identity-server", () => ({
  canonicalIdentityUid: mocks.canonicalIdentityUid,
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: mocks.linkedReplayUid,
}));

vi.mock("@/lib/social/server", () => ({
  associateLinkedIdentity: mocks.associateLinkedIdentity,
  ensureUserProfile: mocks.ensureUserProfile,
  identityUidsFor: mocks.identityUidsFor,
  LinkedIdentityConflictError: mocks.LinkedIdentityConflictError,
  repairHistoricalDesktopIdentityAssociations: mocks.repairHistoricalDesktopIdentityAssociations,
  requireUser: mocks.requireUser,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import { GET, POST } from "@/app/api/account/connection/route";

describe("account connection credential repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canonicalIdentityUid.mockImplementation(async (uid: unknown) => String(uid ?? "").trim());
    mocks.createFirebaseCustomToken.mockImplementation(async (uid: string) => `custom-token-for-${uid}`);
    mocks.ensureUserProfile.mockResolvedValue({
      email: "player@example.com",
      displayName: "Rift Player",
      handle: "riftplayer",
      profileComplete: true,
    });
    mocks.linkedReplayUid.mockImplementation((decoded: { uid?: string } | null) => decoded?.uid ?? "");
    mocks.repairHistoricalDesktopIdentityAssociations.mockResolvedValue([]);
  });

  it("issues a canonical custom token only to a proven authenticated alias", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "desktop-alias"]);
    mocks.requireUser.mockResolvedValue(authResult("desktop-alias", "account-canonical"));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        verified: false,
        uid: "account-canonical",
        authenticatedUid: "desktop-alias",
        replayLibraryReady: false,
        credentialRepair: {
          required: true,
          targetUid: "account-canonical",
          customToken: "custom-token-for-account-canonical",
        },
      },
    });
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledOnce();
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledWith("account-canonical");
    expect(mocks.repairHistoricalDesktopIdentityAssociations).toHaveBeenCalledWith(
      "account-canonical",
      expect.anything(),
      { force: true },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("vary")).toBe("Authorization");
  });

  it("does not issue a repair token when the authenticated UID is already canonical", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical"]);
    mocks.requireUser.mockResolvedValue(authResult("account-canonical", "account-canonical"));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(200);
    expect(mocks.repairHistoricalDesktopIdentityAssociations).toHaveBeenCalledWith(
      "account-canonical",
      expect.anything(),
      { force: true },
    );
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        verified: true,
        uid: "account-canonical",
        replayLibraryReady: true,
        credentialRepair: {
          required: false,
          customToken: "",
        },
      },
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("does not treat a normal canonical profile as an unfinished alias migration", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical"]);
    mocks.requireUser.mockResolvedValue(authResult(
      "account-canonical",
      "account-canonical",
      "google.com",
      {},
    ));

    const response = await GET({} as never);

    expect(response.status).toBe(200);
    expect(mocks.repairHistoricalDesktopIdentityAssociations).toHaveBeenCalledWith(
      "account-canonical",
      expect.anything(),
      { force: false },
    );
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        migrationState: "ready",
        migrationMessage: "",
      },
    });
  });

  it("keeps a source alias pending until that alias migration completes", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "desktop-alias"]);
    mocks.requireUser.mockResolvedValue(authResult(
      "account-canonical",
      "account-canonical",
      "google.com",
      {},
      {},
    ));

    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        migrationState: "pending",
        migrationMessage: "Older account records are still being linked.",
      },
    });
  });

  it("accepts a canonical custom-token session only with its server-owned association", async () => {
    mocks.linkedReplayUid.mockReturnValue("");
    mocks.identityUidsFor.mockResolvedValue(["account-canonical"]);
    mocks.requireUser.mockResolvedValue(authResult("account-canonical", "account-canonical", "custom"));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        verified: true,
        uid: "account-canonical",
        credentialRepair: { required: false },
      },
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("does not treat an anonymous canonical token as a linked account", async () => {
    mocks.linkedReplayUid.mockReturnValue("");
    mocks.requireUser.mockResolvedValue(authResult("account-canonical", "account-canonical", "anonymous"));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "A Google or email RiftLite account is required.",
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("advertises an alias repair on GET without exposing a custom token", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "desktop-alias"]);
    mocks.requireUser.mockResolvedValue(authResult("desktop-alias", "account-canonical"));

    const response = await GET({} as never);

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        verified: false,
        credentialRepair: {
          required: true,
          targetUid: "account-canonical",
          customToken: "",
        },
      },
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("rejects a repair request pinned to an unrelated account", async () => {
    mocks.requireUser.mockResolvedValue(authResult("unrelated-account", "unrelated-account"));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    if (!response) throw new Error("Expected an account connection response");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("pinned to another RiftLite account"),
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
    expect(mocks.identityUidsFor).not.toHaveBeenCalled();
  });

  it("surfaces a historical immutable-link conflict as account attention", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical"]);
    mocks.requireUser.mockResolvedValue(authResult(
      "account-canonical",
      "account-canonical",
      "google.com",
      { desktopIdentityBackfillConflicts: [{ repairRequired: true }] },
    ));

    const response = await GET({} as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        migrationState: "attention",
        migrationMessage: "A historical desktop link needs account support.",
      },
    });
  });

  it("does not throw a 500 when a stale alias conflicts during repair", async () => {
    mocks.identityUidsFor.mockResolvedValue(["account-canonical", "stale-alias"]);
    mocks.associateLinkedIdentity.mockRejectedValueOnce(new mocks.LinkedIdentityConflictError());
    mocks.requireUser.mockResolvedValue(authResult(
      "account-canonical",
      "account-canonical",
      "google.com",
      { migrationCompletedAt: 123, desktopIdentityBackfillConflicts: [{ repairRequired: true }] },
    ));

    const response = await POST(requestWithBody({ expectedUid: "account-canonical" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connection: { migrationState: "attention" },
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });
});

function requestWithBody(body: Record<string, unknown>) {
  return { json: async () => body } as never;
}

function authResult(
  authenticatedUid: string,
  canonicalUid: string,
  signInProvider = "google.com",
  userData: Record<string, unknown> = {},
  aliasData: Record<string, unknown> = { migrationCompletedAt: 123 },
) {
  return {
    authenticatedUid,
    decoded: {
      uid: canonicalUid,
      email: "player@example.com",
      name: "Rift Player",
      firebase: {
        identities: signInProvider === "anonymous" ? {} : { google: ["google-user"] },
        sign_in_provider: signInProvider,
      },
    },
    db: fakeConnectionDatabase(userData, aliasData),
  };
}

function fakeConnectionDatabase(
  userData: Record<string, unknown>,
  aliasData: Record<string, unknown>,
) {
  return {
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({
          data: () => collectionName === "identityAliases"
            ? {
                canonicalUid: "account-canonical",
                sourceUid: "account-canonical",
                ...aliasData,
              }
            : userData,
        })),
        set: vi.fn(async () => undefined),
        collection: vi.fn(() => ({
          count: vi.fn(() => ({
            get: vi.fn(async () => ({ data: () => ({ count: 4 }) })),
          })),
        })),
        collectionName,
      })),
    })),
  };
}
