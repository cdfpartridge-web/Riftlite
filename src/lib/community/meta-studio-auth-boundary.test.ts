import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canonicalIdentityUid: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  requireUser: vi.fn(),
  verifyFirebaseSessionCookie: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
  verifyFirebaseSessionCookie: mocks.verifyFirebaseSessionCookie,
}));

vi.mock("@/lib/identity-server", () => ({
  canonicalIdentityUid: mocks.canonicalIdentityUid,
}));

vi.mock("@/lib/social/server", () => ({
  requireUser: mocks.requireUser,
}));

import {
  requireMetaStudioBearer,
  requireMetaStudioSession,
  verifyMetaStudioSession,
} from "@/lib/community/meta-studio-auth";

const REQUEST = new NextRequest("https://www.riftlite.com/api/meta-studio/report", {
  headers: { Cookie: "riftlite_meta_studio=signed-session" },
});

describe("Meta Studio authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RIFTLITE_META_STUDIO_UIDS", "canonical-bmu");
    mocks.getFirestoreAdmin.mockReturnValue({ collection: vi.fn() });
    mocks.verifyFirebaseSessionCookie.mockResolvedValue({ uid: "canonical-bmu" });
    mocks.canonicalIdentityUid.mockResolvedValue("canonical-bmu");
    mocks.requireUser.mockResolvedValue({
      uid: "canonical-bmu",
      authenticatedUid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
      db: {},
      token: "firebase-token",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed with private headers when the allowlist is absent", async () => {
    vi.stubEnv("RIFTLITE_META_STUDIO_UIDS", "");

    const auth = await requireMetaStudioSession(REQUEST);

    expect("error" in auth && auth.error.status).toBe(503);
    if ("error" in auth) {
      expect(auth.error.headers.get("cache-control")).toContain("no-store");
      expect(auth.error.headers.get("vary")).toContain("Cookie");
      expect(auth.error.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(mocks.verifyFirebaseSessionCookie).not.toHaveBeenCalled();
  });

  it("rejects a valid bearer token for any non-allowlisted canonical UID", async () => {
    mocks.requireUser.mockResolvedValue({
      uid: "someone-else",
      authenticatedUid: "someone-else",
      decoded: { uid: "someone-else" },
      db: {},
      token: "firebase-token",
    });

    const auth = await requireMetaStudioBearer(REQUEST);

    expect("error" in auth && auth.error.status).toBe(403);
  });

  it("accepts a proven identity alias only after it resolves to the allowlisted UID", async () => {
    mocks.verifyFirebaseSessionCookie.mockResolvedValue({ uid: "historical-alias" });
    mocks.canonicalIdentityUid.mockResolvedValue("canonical-bmu");

    const principal = await verifyMetaStudioSession("signed-session");

    expect(mocks.canonicalIdentityUid).toHaveBeenCalledWith(
      "historical-alias",
      expect.any(Object),
    );
    expect(principal).toMatchObject({
      uid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
    });
  });

  it.each([
    ["invalid or revoked cookie", null, {}],
    ["missing Firestore admin", { uid: "canonical-bmu" }, null],
  ])("rejects a session with %s", async (_label, decoded, db) => {
    mocks.verifyFirebaseSessionCookie.mockResolvedValue(decoded);
    mocks.getFirestoreAdmin.mockReturnValue(db);

    const auth = await requireMetaStudioSession(REQUEST);

    expect("error" in auth && auth.error.status).toBe(401);
  });

  it("preserves private headers from lower-level bearer failures", async () => {
    mocks.requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });

    const auth = await requireMetaStudioBearer(REQUEST);

    expect("error" in auth && auth.error.status).toBe(401);
    if ("error" in auth) {
      expect(auth.error.headers.get("cache-control")).toContain("no-store");
      expect(auth.error.headers.get("vary")).toContain("Authorization");
    }
  });
});
