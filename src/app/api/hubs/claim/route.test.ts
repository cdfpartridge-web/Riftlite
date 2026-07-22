import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureUserProfile: vi.fn(),
  identityUidsFor: vi.fn(),
  linkedReplayUid: vi.fn(),
  requireUser: vi.fn(),
  saveAccountProfile: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: mocks.linkedReplayUid,
}));

vi.mock("@/lib/social/hub-lifecycle", () => ({
  primaryOwnerUid: (hub: Record<string, unknown>) =>
    String(hub.owner_uid ?? hub.ownerUid ?? hub.created_by ?? hub.createdBy ?? "").trim(),
}));

vi.mock("@/lib/social/server", () => ({
  bestProfileDisplayName: (_uid: string, ...values: unknown[]) =>
    values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "Rift Player",
  cleanDisplayName: (...values: unknown[]) =>
    values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "",
  ensureUserProfile: mocks.ensureUserProfile,
  hubIdFromName: (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  identityUidsFor: mocks.identityUidsFor,
  requireUser: mocks.requireUser,
  saveAccountProfile: mocks.saveAccountProfile,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

import { POST } from "@/app/api/hubs/claim/route";

describe("legacy private hub claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureUserProfile.mockResolvedValue({ displayName: "Rift Player", handle: "riftplayer" });
    mocks.saveAccountProfile.mockResolvedValue({ displayName: "Rift Player", handle: "riftplayer" });
    mocks.identityUidsFor.mockResolvedValue(["account-uid", "desktop-uid"]);
    mocks.linkedReplayUid.mockReturnValue("account-uid");
  });

  it("accepts an account-managed hub still owned by the same account's desktop alias", async () => {
    const fake = fakeDatabase({
      name: "Legacy Hub",
      password_hash: passwordHash("correct horse"),
      role_mode: "account",
      owner_uid: "desktop-uid",
      created_by: "desktop-uid",
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));

    const response = await POST(request({ hubId: "legacy-hub", password: "correct horse" }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected a claim response.");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.readWrite("hubs/legacy-hub")).toMatchObject({
      owner_uid: "account-uid",
      created_by: "account-uid",
      role_mode: "account",
    });
    expect(fake.readWrite("hubs/legacy-hub/members/account-uid")).toMatchObject({
      uid: "account-uid",
      role: "owner",
    });
  });

  it("keeps password ownership recovery available for a password-only legacy hub", async () => {
    const fake = fakeDatabase({
      name: "Legacy Hub",
      password_hash: passwordHash("  legacy secret  "),
      created_by: "unlinked-legacy-creator",
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));

    const response = await POST(request({ hubId: "legacy-hub", password: "  legacy secret  " }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected a claim response.");
    expect(response.status).toBe(200);
    expect(fake.readWrite("hubs/legacy-hub")).toMatchObject({
      owner_uid: "account-uid",
      created_by: "account-uid",
      role_mode: "account",
    });
  });

  it("does not let a password transfer an account-managed hub to another account", async () => {
    const fake = fakeDatabase({
      name: "Someone Else's Hub",
      password_hash: passwordHash("shared password"),
      role_mode: "account",
      owner_uid: "different-account",
      created_by: "desktop-uid",
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));

    const response = await POST(request({ hubId: "legacy-hub", password: "shared password" }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected a claim response.");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This hub has already been claimed by another account." });
    expect(fake.writes.size).toBe(0);
  });

  it("does not let an anonymous Firebase identity convert a hub to account ownership", async () => {
    const fake = fakeDatabase({
      name: "Legacy Hub",
      password_hash: passwordHash("legacy secret"),
      created_by: "anonymous-uid",
    });
    mocks.requireUser.mockResolvedValue(auth(fake.db));
    mocks.linkedReplayUid.mockReturnValue("");

    const response = await POST(request({ hubId: "legacy-hub", password: "legacy secret" }));

    expect(response).toBeDefined();
    if (!response) throw new Error("Expected a claim response.");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Create or sign in to a recoverable RiftLite account first.",
    });
    expect(fake.writes.size).toBe(0);
  });

  it("accepts a historical desktop credential with a proven canonical association", async () => {
    const fake = fakeDatabase({
      name: "Legacy Hub",
      password_hash: passwordHash("legacy secret"),
      owner_uid: "desktop-uid",
      created_by: "desktop-uid",
      role_mode: "account",
    });
    mocks.linkedReplayUid.mockReturnValue("");
    mocks.requireUser.mockResolvedValue({
      ...auth(fake.db),
      authenticatedUid: "desktop-uid",
    });

    const response = await POST(request({ hubId: "legacy-hub", password: "legacy secret" }));

    expect(response?.status).toBe(200);
    expect(fake.readWrite("hubs/legacy-hub")).toMatchObject({ owner_uid: "account-uid" });
  });
});

function auth(db: ReturnType<typeof fakeDatabase>["db"]) {
  return {
    db,
    authenticatedUid: "account-uid",
    decoded: {
      uid: "account-uid",
      name: "Rift Player",
      email: "player@example.com",
    },
  };
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/hubs/claim", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function passwordHash(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function fakeDatabase(hubData: Record<string, unknown>) {
  type Ref = { path: string; collection: (name: string) => { doc: (id: string) => Ref } };
  const writes = new Map<string, Record<string, unknown>>();
  const ref = (path: string): Ref => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(callback: (tx: {
      get: (target: Ref) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
      set: (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => callback({
      get: async () => ({ exists: true, data: () => ({ ...hubData }) }),
      set: (target, data, options) => {
        const previous = options?.merge ? writes.get(target.path) ?? {} : {};
        writes.set(target.path, { ...previous, ...data });
      },
    }),
  };
  return {
    db,
    writes,
    readWrite: (path: string) => writes.get(path),
  };
}
