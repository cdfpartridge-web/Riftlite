import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canonicalIdentityUid: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  verifyFirebaseIdToken: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
  verifyFirebaseIdToken: mocks.verifyFirebaseIdToken,
}));

vi.mock("@/lib/identity-server", () => ({
  canonicalIdentityUid: mocks.canonicalIdentityUid,
}));

import {
  requireFirebaseBearerUser,
  requireReplayMutationUser,
  verifiedRecoverableAccountUid,
} from "@/lib/replay-v2-server/auth";
import { REPLAY_EMBED_COOKIE, signReplayEmbedSession } from "./session";

describe("Replay V2 bearer authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canonicalIdentityUid.mockImplementation(async (uid: string) => uid);
    mocks.getFirestoreAdmin.mockReturnValue(fakeDb(null));
  });

  it("accepts a durable provider token without an association read", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "account-123",
      email_verified: true,
      firebase: { identities: { email: ["linked@example.com"] }, sign_in_provider: "password" },
    });

    await expect(requireFirebaseBearerUser(request("token"))).resolves.toBe("account-123");
    expect(mocks.getFirestoreAdmin).not.toHaveBeenCalled();
  });

  it("accepts an exact server-owned historical desktop alias", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "legacy-desktop",
      firebase: { identities: {}, sign_in_provider: "anonymous" },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fakeDb({
      sourceUid: "legacy-desktop",
      canonicalUid: "account-123",
    }));

    await expect(requireFirebaseBearerUser(request("token"))).resolves.toBe("account-123");
  });

  it("accepts a refreshed bare custom token only with its canonical self association", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue({
      uid: "account-123",
      firebase: { identities: {}, sign_in_provider: "custom" },
    });
    mocks.getFirestoreAdmin.mockReturnValue(fakeDb({
      sourceUid: "account-123",
      canonicalUid: "account-123",
    }));

    await expect(requireFirebaseBearerUser(request("token"))).resolves.toBe("account-123");
  });

  it("exposes the same exact association proof to non-Replay account routes", async () => {
    mocks.getFirestoreAdmin.mockReturnValue(fakeDb({
      sourceUid: "account-123",
      canonicalUid: "account-123",
    }));

    await expect(verifiedRecoverableAccountUid({
      uid: "account-123",
      firebase: { identities: {}, sign_in_provider: "custom" },
    } as never)).resolves.toBe("account-123");
    await expect(verifiedRecoverableAccountUid({
      uid: "unlinked-custom",
      firebase: { identities: {}, sign_in_provider: "custom" },
    } as never)).resolves.toBe("");
  });

  it("rejects unassociated anonymous and bare custom credentials", async () => {
    for (const signInProvider of ["anonymous", "custom"]) {
      mocks.verifyFirebaseIdToken.mockResolvedValue({
        uid: "unlinked-account",
        firebase: { identities: {}, sign_in_provider: signInProvider },
      });
      mocks.getFirestoreAdmin.mockReturnValue(fakeDb(null));

      await expect(requireFirebaseBearerUser(request("token"))).rejects.toMatchObject({
        code: "authentication_required",
        status: 401,
      });
    }
  });

  it("distinguishes a rejected token from a missing token", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue(null);

    await expect(requireFirebaseBearerUser(request("token"))).rejects.toThrow("invalid or expired");
    await expect(requireFirebaseBearerUser(request())).rejects.toThrow("token is required");
  });
});

describe("replay visibility session mutations", () => {
  const secret = "test-replay-session-secret-at-least-32-bytes";
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REPLAY_EMBED_SESSION_SECRET", secret);
    mocks.canonicalIdentityUid.mockImplementation(async (uid: string) => uid);
    mocks.getFirestoreAdmin.mockReturnValue(fakeDb(null));
  });
  afterEach(() => vi.unstubAllEnvs());
  function mutation(origin?: string, token = signReplayEmbedSession("owner-1", secret)) {
    return new Request("https://www.riftlite.com/api/v2/replays/rl2_test", {
      method: "PATCH", headers: { cookie: `${REPLAY_EMBED_COOKIE}=${token}`, ...(origin ? { origin } : {}) },
    });
  }
  it("accepts a current signed owner session from the same origin", async () => {
    await expect(requireReplayMutationUser(mutation("https://www.riftlite.com"))).resolves.toBe("owner-1");
  });
  it.each([undefined, "null", "https://evil.example", "https://riftlite.com.evil.example"])("rejects cookie mutation from %s before resolving identity", async (origin) => {
    await expect(requireReplayMutationUser(mutation(origin))).rejects.toMatchObject({ status: 403, code: "replay_origin_required" });
    expect(mocks.canonicalIdentityUid).not.toHaveBeenCalled();
  });
  it("rejects expired sessions even from the same origin", async () => {
    await expect(requireReplayMutationUser(mutation("https://www.riftlite.com", signReplayEmbedSession("owner-1", secret, Date.now() - 11 * 60_000)))).rejects.toMatchObject({ status: 401 });
  });
  it("retains bearer desktop API compatibility without an Origin header", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue({ uid: "owner-1", email_verified: true, firebase: { identities: { email: ["owner@example.com"] }, sign_in_provider: "password" } });
    await expect(requireReplayMutationUser(request("token"))).resolves.toBe("owner-1");
  });
  it("does not let an invalid bearer credential fall through to the cookie", async () => {
    mocks.verifyFirebaseIdToken.mockResolvedValue(null);
    const req = mutation("https://www.riftlite.com"); req.headers.set("authorization", "Bearer invalid");
    await expect(requireReplayMutationUser(req)).rejects.toMatchObject({ status: 401 });
  });
});

function request(token = ""): Request {
  return new Request("https://www.riftlite.com/api/v2/replays/init", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function fakeDb(data: Record<string, unknown> | null) {
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({ data: () => data })),
      })),
    })),
  };
}
