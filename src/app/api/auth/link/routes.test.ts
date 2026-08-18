import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  associateLinkedIdentity: vi.fn(),
  canonicalIdentityUid: vi.fn(),
  createFirebaseCustomToken: vi.fn(),
  ensureUserProfile: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  linkedReplayUid: vi.fn(),
  newLinkSession: vi.fn(),
  repairHistoricalDesktopIdentityAssociations: vi.fn(),
  requireUser: vi.fn(),
  verifyFirebaseIdToken: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  createFirebaseCustomToken: mocks.createFirebaseCustomToken,
  getFirestoreAdmin: mocks.getFirestoreAdmin,
  verifyFirebaseIdToken: mocks.verifyFirebaseIdToken,
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
  LinkedIdentityConflictError: class LinkedIdentityConflictError extends Error {},
  newLinkSession: mocks.newLinkSession,
  repairHistoricalDesktopIdentityAssociations: mocks.repairHistoricalDesktopIdentityAssociations,
  requireUser: mocks.requireUser,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import { POST as completeLink } from "@/app/api/auth/link/complete/route";
import { POST as startLink } from "@/app/api/auth/link/start/route";
import { GET as linkStatus } from "@/app/api/auth/link/status/route";

describe("desktop account-link routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canonicalIdentityUid.mockImplementation(async (uid: unknown) => String(uid ?? "").trim());
    mocks.createFirebaseCustomToken.mockImplementation(async (uid: string) => `token-for-${uid}`);
    mocks.ensureUserProfile.mockResolvedValue({ displayName: "Rift Player" });
    mocks.linkedReplayUid.mockImplementation((decoded: { uid?: string } | null) => decoded?.uid ?? "");
    mocks.newLinkSession.mockImplementation((desktopUid: string) => ({
      sessionId: "session-1",
      code: "LINKCODE",
      desktopUid,
      status: "pending",
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    }));
  });

  it("stores the raw authenticated UID as owner while canonicalizing the reconnect pin", async () => {
    const { db, ref } = fakeLinkDatabase();
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: {
        uid: "account-canonical",
        firebase: { identities: { google: ["google-user"] } },
      },
      db,
    });
    mocks.canonicalIdentityUid.mockResolvedValue("account-canonical");

    const response = await startLink({
      json: async () => ({ expectedUid: "remembered-alias" }),
      nextUrl: new URL("https://riftlite.example/api/auth/link/start"),
    } as never);

    if (!response) throw new Error("Expected the start route to return a response");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.newLinkSession).toHaveBeenCalledWith("desktop-raw");
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      expectedUid: "account-canonical",
    }));
  });

  it("marks start and status authentication errors private and no-store", async () => {
    mocks.requireUser.mockImplementation(async () => ({
      error: Response.json({ error: "Invalid or expired ID token" }, { status: 401 }),
    }));

    const startResponse = await startLink({} as never);
    const statusResponse = await linkStatus({} as never);

    for (const response of [startResponse, statusResponse]) {
      if (!response) throw new Error("Expected a private authentication error response");
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("pins a canonical account recovered from an anonymous desktop token", async () => {
    const { db, ref } = fakeLinkDatabase();
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: {
        uid: "account-canonical",
        firebase: { identities: { anonymous: ["desktop-raw"] } },
      },
      db,
    });
    mocks.linkedReplayUid.mockReturnValue("");

    const response = await startLink({
      json: async () => ({}),
      nextUrl: new URL("https://riftlite.example/api/auth/link/start"),
    } as never);

    if (!response) throw new Error("Expected the start route to return a response");
    expect(response.status).toBe(200);
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      desktopUid: "desktop-raw",
      expectedUid: "account-canonical",
    }));
  });

  it("treats a legacy anonymous desktop self-pin as first account adoption", async () => {
    const { db, ref } = fakeLinkDatabase();
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "anonymous-desktop",
      decoded: {
        uid: "anonymous-desktop",
        firebase: { identities: {}, sign_in_provider: "anonymous" },
      },
      db,
    });
    mocks.linkedReplayUid.mockReturnValue("");

    const response = await startLink({
      json: async () => ({ expectedUid: "anonymous-desktop" }),
      nextUrl: new URL("https://riftlite.example/api/auth/link/start"),
    } as never);

    expect(response?.status).toBe(200);
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      desktopUid: "anonymous-desktop",
      expectedUid: "",
      anonymousAdoptionSourceUid: "anonymous-desktop",
    }));
  });

  it("does not release a remembered account pin from a bare custom credential", async () => {
    const { db, ref } = fakeLinkDatabase();
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "remembered-account",
      decoded: {
        uid: "remembered-account",
        firebase: { identities: {}, sign_in_provider: "custom" },
      },
      db,
    });
    mocks.linkedReplayUid.mockReturnValue("");

    const response = await startLink({
      json: async () => ({ expectedUid: "remembered-account" }),
      nextUrl: new URL("https://riftlite.example/api/auth/link/start"),
    } as never);

    expect(response?.status).toBe(200);
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      expectedUid: "remembered-account",
      anonymousAdoptionSourceUid: "",
    }));
  });

  it("lets the raw session owner poll after requireUser canonicalizes its UID", async () => {
    const { db, ref } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      status: "complete",
      linkedUid: "account-canonical",
      linkedEmail: "player@example.com",
      linkedName: "Rift Player",
      anonymousAdoptionSourceUid: "desktop-raw",
      customToken: "single-use-token",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "account-canonical" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "complete",
      uid: "account-canonical",
      customToken: "single-use-token",
      anonymousAdoptionSourceUid: "desktop-raw",
    });
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      customToken: "",
      linkedUid: "account-canonical",
    }), { merge: true });
  });

  it("does not expose an adoption source that is not the session owner", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      status: "complete",
      linkedUid: "account-canonical",
      anonymousAdoptionSourceUid: "another-device",
      customToken: "single-use-token",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "desktop-raw" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    await expect(response.json()).resolves.not.toHaveProperty("anonymousAdoptionSourceUid");
  });

  it("does not let another alias poll a versioned raw-owner session", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "account-canonical",
      desktopUidBindingVersion: 2,
      status: "pending",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "another-alias",
      decoded: { uid: "account-canonical" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Session belongs to another device",
    });
    expect(mocks.canonicalIdentityUid).not.toHaveBeenCalled();
  });

  it("canonicalizes only when an older status session stored the canonical owner", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "account-canonical",
      desktopUidBindingVersion: 1,
      status: "pending",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "desktop-raw" },
      db,
    });
    mocks.canonicalIdentityUid.mockResolvedValue("account-canonical");

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "pending" });
    expect(mocks.canonicalIdentityUid).toHaveBeenCalledOnce();
    expect(mocks.canonicalIdentityUid).toHaveBeenCalledWith("desktop-raw", db);
  });

  it("expires a crashed completion claim instead of polling forever", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      status: "completing",
      completingUid: "account-canonical",
      expiresAt: Date.now() - 1,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "account-canonical" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "expired" });
  });

  it("keeps an active completion claim compatible with pending desktop polling", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      status: "completing",
      completingUid: "account-canonical",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "account-canonical" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    await expect(response.json()).resolves.toEqual({ status: "pending" });
  });

  it("rejects a malformed completed session without a linked account", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      desktopUidBindingVersion: 2,
      status: "complete",
      linkedUid: "",
      customToken: "must-not-be-returned",
      expiresAt: Date.now() + 60_000,
    });
    mocks.requireUser.mockResolvedValue({
      authenticatedUid: "desktop-raw",
      decoded: { uid: "account-canonical" },
      db,
    });

    const response = await linkStatus({
      nextUrl: new URL("https://riftlite.example/api/auth/link/status?sessionId=session-1"),
    } as never);

    if (!response) throw new Error("Expected the status route to return a response");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "Link session is missing its linked account",
    });
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("canonicalizes both the pinned and selected accounts before completing", async () => {
    const { db, ref } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      expectedUid: "remembered-alias",
      status: "pending",
      code: "LINKCODE",
      expiresAt: Date.now() + 60_000,
    });
    mocks.getFirestoreAdmin.mockReturnValue(db);
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "selected-alias",
      email: "player@example.com",
      name: "Rift Player",
      firebase: { identities: { google: ["google-user"] } },
    });
    mocks.canonicalIdentityUid.mockImplementation(async (uid: unknown) => {
      const value = String(uid ?? "").trim();
      return value === "remembered-alias" || value === "selected-alias"
        ? "account-canonical"
        : value;
    });

    const response = await completeLink({
      json: async () => ({
        sessionId: "session-1",
        code: "linkcode",
        idToken: "website-id-token",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.associateLinkedIdentity).toHaveBeenCalledWith("desktop-raw", "account-canonical");
    expect(mocks.repairHistoricalDesktopIdentityAssociations).toHaveBeenCalledWith(
      "account-canonical",
      db,
      { force: true },
    );
    expect(mocks.createFirebaseCustomToken).toHaveBeenCalledWith("account-canonical");
    expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
      expectedUid: "account-canonical",
      linkedUid: "account-canonical",
      customToken: "token-for-account-canonical",
    }), { merge: true });
  });

  it("rejects an unverified email/password account before claiming the link session", async () => {
    const { db } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      status: "pending",
      code: "LINKCODE",
      expiresAt: Date.now() + 60_000,
    });
    mocks.getFirestoreAdmin.mockReturnValue(db);
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "email-account",
      email: "player@example.com",
      email_verified: false,
      firebase: {
        identities: { email: ["player@example.com"] },
        sign_in_provider: "password",
      },
    });

    const response = await completeLink(linkRequest("unverified-email-token"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Verify your email before linking this desktop.",
    });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(mocks.associateLinkedIdentity).not.toHaveBeenCalled();
    expect(mocks.createFirebaseCustomToken).not.toHaveBeenCalled();
  });

  it("atomically prevents two accounts from claiming the same unpinned session", async () => {
    const { db, getData } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      expectedUid: "",
      status: "pending",
      code: "LINKCODE",
      expiresAt: Date.now() + 60_000,
    });
    mocks.getFirestoreAdmin.mockReturnValue(db);
    mocks.verifyFirebaseIdToken.mockImplementation(async (token: string) => ({
      uid: token === "token-a" ? "account-a" : "account-b",
      email: `${token}@example.com`,
      firebase: { identities: { google: [token] } },
    }));
    let releaseFirstAssociation: (() => void) | undefined;
    const firstAssociation = new Promise<void>((resolve) => {
      releaseFirstAssociation = resolve;
    });
    mocks.associateLinkedIdentity.mockImplementation(async (_source: string, uid: string) => {
      if (uid === "account-a") await firstAssociation;
    });

    const first = completeLink(linkRequest("token-a"));
    await vi.waitFor(() => expect(getData().status).toBe("completing"));
    const competing = await completeLink(linkRequest("token-b"));

    expect(competing.status).toBe(409);
    await expect(competing.json()).resolves.toMatchObject({
      error: expect.stringContaining("same RiftLite account"),
    });
    expect(mocks.associateLinkedIdentity).not.toHaveBeenCalledWith("desktop-raw", "account-b");

    releaseFirstAssociation?.();
    expect((await first).status).toBe(200);
    expect(getData()).toMatchObject({ status: "complete", linkedUid: "account-a" });
  });

  it("lets the selected account recover a failed completion claim", async () => {
    const { db, getData } = fakeLinkDatabase({
      desktopUid: "desktop-raw",
      expectedUid: "",
      status: "pending",
      code: "LINKCODE",
      expiresAt: Date.now() + 60_000,
    });
    mocks.getFirestoreAdmin.mockReturnValue(db);
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "account-a",
      email: "a@example.com",
      firebase: { identities: { google: ["account-a"] } },
    });
    mocks.associateLinkedIdentity
      .mockRejectedValueOnce(new Error("temporary migration failure"))
      .mockResolvedValueOnce(undefined);

    const failed = await completeLink(linkRequest("token-a"));
    expect(failed.status).toBe(500);
    expect(getData()).toMatchObject({
      status: "completing",
      completingUid: "account-a",
      completionLeaseExpiresAt: 0,
    });

    const recovered = await completeLink(linkRequest("token-a"));
    expect(recovered.status).toBe(200);
    expect(getData()).toMatchObject({
      status: "complete",
      linkedUid: "account-a",
      completionAttempts: 2,
    });
  });
});

function linkRequest(idToken: string) {
  return {
    json: async () => ({
      sessionId: "session-1",
      code: "LINKCODE",
      idToken,
    }),
  } as never;
}

function fakeLinkDatabase(initialData: Record<string, unknown> = {}) {
  let data = { ...initialData };
  const ref = {
    get: vi.fn(async () => ({
      exists: true,
      data: () => ({ ...data }),
    })),
    set: vi.fn(async (next: Record<string, unknown>, options?: { merge?: boolean }) => {
      data = options?.merge ? { ...data, ...next } : { ...next };
    }),
  };
  let transactionTail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ref),
    })),
    runTransaction: vi.fn(<T>(callback: (tx: {
      get: (_target: unknown) => ReturnType<typeof ref.get>;
      set: (_target: unknown, next: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => {
      const result = transactionTail.then(() => callback({
        get: () => ref.get(),
        set: (_target, next, options) => {
          void ref.set(next, options);
        },
      }));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
  };
  return { db, ref, getData: () => ({ ...data }) };
}
