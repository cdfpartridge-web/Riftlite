import { beforeEach, describe, expect, it, vi } from "vitest";

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
  verifiedRecoverableAccountUid,
} from "@/lib/replay-v2-server/auth";

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
