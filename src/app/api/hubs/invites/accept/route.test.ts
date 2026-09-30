import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  ensureUserProfile: vi.fn(),
  identityUidsFor: vi.fn(),
  profileIsComplete: vi.fn(),
  repairProfileReferences: vi.fn(),
}));

vi.mock("@/lib/replay-v2-server/identity", () => ({
  linkedReplayUid: (decoded: { uid: string }) => decoded.uid,
}));
vi.mock("@/lib/social/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/social/server")>();
  return {
    ...mocks,
    bestProfileDisplayName: (_uid: string, name: string) => name,
    hubRecordOwnedByIdentity: original.hubRecordOwnedByIdentity,
    socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
  };
});

import { POST } from "@/app/api/hubs/invites/accept/route";

const invitePath = "hubInvites/invite-a";
const hubPath = "hubs/private-hub";
const memberPath = `${hubPath}/members/player`;
const aliasPath = `${hubPath}/members/desktop-player`;
const inboxPath = "users/player/inbox/invite-a";

describe("private hub invitation acceptance", () => {
  let fake: ReturnType<typeof fakeDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = fakeDatabase({
      [invitePath]: { hubId: "private-hub", status: "open", expiresAt: Date.now() + 60_000 },
      [hubPath]: { name: "Private Hub", role_mode: "account", owner_uid: "hub-owner" },
    });
    mocks.requireUser.mockImplementation(async (req: NextRequest) => {
      const uid = req.headers.get("authorization")?.replace("Bearer ", "") || "player";
      return { db: fake.db, authenticatedUid: uid, decoded: { uid } };
    });
    mocks.ensureUserProfile.mockImplementation(async (uid: string) => ({ uid, handle: uid, handleLower: uid, displayName: "Player" }));
    mocks.identityUidsFor.mockImplementation(async (uid: string) => uid === "player" ? [uid, "desktop-player"] : [uid]);
    mocks.profileIsComplete.mockReturnValue(true);
    mocks.repairProfileReferences.mockResolvedValue(undefined);
  });

  it("atomically joins a new member and consumes the single-use invitation", async () => {
    const response = await accept();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, hubId: "private-hub", alreadyMember: false,
      hub: { id: "private-hub", name: "Private Hub", role: "member" },
    });
    expect(fake.get(memberPath)).toMatchObject({ uid: "player", role: "member", displayName: "Player" });
    expect(fake.get(invitePath)).toMatchObject({ status: "accepted", acceptedBy: "player" });
    expect(fake.get(inboxPath)).toMatchObject({ status: "accepted" });
    expect(fake.commits).toHaveLength(1);
    expect(fake.commits[0].sort()).toEqual([memberPath, invitePath, inboxPath].sort());
  });

  it.each(["member", "admin", "owner"])("keeps an existing %s and the invitation unchanged", async (role) => {
    fake.set(memberPath, { uid: "player", role, joinedAt: 123, updatedAt: 456 });
    const before = fake.get(memberPath);
    const response = await accept();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role } });
    expect(fake.get(memberPath)).toEqual(before);
    expect(fake.get(invitePath)?.status).toBe("open");
    expect(fake.commits).toEqual([]);
  });

  it("preserves the strongest validated alias role without creating a weaker canonical membership", async () => {
    fake.set(memberPath, { role: "member" });
    fake.set(aliasPath, { role: "admin" });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "admin" } });
    expect(fake.get(memberPath)?.role).toBe("member");
    expect(fake.get(aliasPath)?.role).toBe("admin");
    expect(fake.commits).toEqual([]);
  });

  it.each([
    { role_mode: "account", owner_uid: "player", created_by: "someone-else" },
    { role_mode: "account", owner_uid: "desktop-player" },
    { created_by: "desktop-player" },
  ])("recognizes owner metadata even without a member document: %o", async (ownership) => {
    fake.set(hubPath, { name: "Private Hub", ...ownership });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "owner" } });
    expect(fake.commits).toEqual([]);
    expect(fake.get(invitePath)?.status).toBe("open");
  });

  it("does not treat a former creator as current owner of an account-managed hub", async () => {
    fake.set(hubPath, { name: "Private Hub", role_mode: "account", created_by: "player", owner_uid: "someone-else" });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: false, hub: { role: "member" } });
  });

  it("reports the authoritative owner role when an earlier acceptance downgraded their member document", async () => {
    fake.patch(hubPath, { owner_uid: "player" });
    fake.patch(invitePath, { status: "accepted", acceptedBy: "player", createdBy: "player" });
    fake.set(memberPath, { uid: "player", role: "member", joinedAt: 123 });
    const response = await accept();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "owner" } });
    expect(fake.get(memberPath)).toEqual({ uid: "player", role: "member", joinedAt: 123 });
    expect(fake.commits).toEqual([]);
  });

  it("does not consider unrelated memberships when preserving roles", async () => {
    fake.set(`${hubPath}/members/unrelated`, { role: "owner" });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: false, hub: { role: "member" } });
  });

  it("repeated acceptance by a current member is idempotent", async () => {
    await accept();
    fake.set(memberPath, { ...fake.get(memberPath), role: "admin" });
    const before = fake.get(invitePath);
    fake.commits.length = 0;
    const response = await accept();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "admin" } });
    expect(fake.get(invitePath)).toEqual(before);
    expect(fake.commits).toEqual([]);
  });

  it("recognizes an accepted receipt and membership under a validated old identity", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "desktop-player" });
    fake.set(aliasPath, { role: "member" });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "member" } });
    expect(fake.commits).toEqual([]);
  });

  it("never restores removed membership from a previously accepted invitation", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "player" });
    const response = await accept();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Invite is no longer open" });
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.commits).toEqual([]);
  });

  it("rejects an accepted link belonging to another account without exposing that account", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "secret-other-account" });
    const response = await accept();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Invite is no longer open" });
    expect(fake.commits).toEqual([]);
  });

  it.each([{ targetUid: "someone-else" }, { targetHandle: "someone-else" }])("retains target restrictions even for the owner: %o", async (target) => {
    fake.patch(hubPath, { owner_uid: "player" });
    fake.patch(invitePath, target);
    const response = await accept();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invite was sent to another profile" });
    expect(fake.commits).toEqual([]);
  });

  it("allows a target UID belonging to the validated old identity", async () => {
    fake.patch(invitePath, { targetUid: "desktop-player", targetHandle: "old-handle" });
    expect((await accept()).status).toBe(200);
  });

  it.each(["accepted", "declined", "revoked"])("does not reopen a %s invitation", async (status) => {
    fake.patch(invitePath, { status });
    expect((await accept()).status).toBe(409);
    expect(fake.commits).toEqual([]);
  });

  it("rejects an expired invitation even for an existing member", async () => {
    fake.patch(invitePath, { expiresAt: Date.now() - 1 });
    fake.set(memberPath, { role: "admin" });
    expect((await accept()).status).toBe(410);
    expect(fake.commits).toEqual([]);
  });

  it.each(["missing", "deleting"])("rejects a %s hub even for an existing member", async (state) => {
    if (state === "missing") fake.remove(hubPath);
    else fake.patch(hubPath, { lifecycle_state: "deleting" });
    fake.set(memberPath, { role: "member" });
    const response = await accept();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "hub_unavailable" });
    expect(fake.commits).toEqual([]);
  });

  it.each([
    { patch: { targetUid: "someone-else" }, status: 403 },
    { patch: { expiresAt: 1 }, status: 410 },
    { patch: { status: "declined" }, status: 409 },
    { patch: { hubId: "other-hub" }, status: 409 },
  ])("rechecks invitation changes inside the transaction: %o", async ({ patch, status }) => {
    fake.beforeTransaction = () => fake.patch(invitePath, patch);
    expect((await accept()).status).toBe(status);
    expect(fake.commits).toEqual([]);
  });

  it("retries an acceptance racing with a promotion without consuming the link or downgrading", async () => {
    fake.beforeCommit = () => fake.set(aliasPath, { role: "admin", joinedAt: 100 });
    const response = await accept();
    expect(await response.json()).toMatchObject({ alreadyMember: true, hub: { role: "admin" } });
    expect(fake.attempts).toBe(2);
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.get(invitePath)?.status).toBe("open");
    expect(fake.commits).toEqual([]);
  });

  it("rechecks removed membership during a repeated acceptance", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "player" });
    fake.set(memberPath, { role: "member" });
    fake.beforeCommit = () => fake.remove(memberPath);
    const response = await accept();
    expect(response.status).toBe(409);
    expect(fake.attempts).toBe(2);
    expect(fake.commits).toEqual([]);
    expect(fake.get(memberPath)).toBeUndefined();
  });

  it("rechecks authoritative ownership during a repeated acceptance", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "player" });
    fake.patch(hubPath, { owner_uid: "player", created_by: "player" });
    fake.beforeCommit = () => fake.patch(hubPath, { owner_uid: "new-owner" });
    const response = await accept();
    expect(response.status).toBe(409);
    expect(fake.attempts).toBe(2);
    expect(fake.commits).toEqual([]);
    expect(fake.get(memberPath)).toBeUndefined();
  });

  it("only one of two concurrent new accounts can consume an untargeted invitation", async () => {
    const responses = await Promise.all([accept("player"), accept("other-player")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(fake.commits).toHaveLength(1);
    const winner = fake.get(invitePath)?.acceptedBy;
    expect(fake.get(`${hubPath}/members/${winner}`)).toBeDefined();
    const loser = winner === "player" ? "other-player" : "player";
    expect(fake.get(`${hubPath}/members/${loser}`)).toBeUndefined();
    expect(fake.attempts).toBe(3);
  });

  async function accept(uid = "player") {
    const response = await POST(new NextRequest("https://riftlite.test/api/hubs/invites/accept", {
      method: "POST",
      headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" },
      body: JSON.stringify({ inviteId: "invite-a" }),
    }));
    if (!response) throw new Error("Expected an invitation response");
    return response;
  }
});

type Data = Record<string, unknown>;
type Ref = { path: string; get(): Promise<Snapshot>; collection(name: string): { doc(id: string): Ref } };
type Snapshot = { exists: boolean; data(): Data | undefined };

// Optimistic transaction fake: writes are staged, every read has a version,
// and conflicting attempts are discarded and retried as Firestore does.
function fakeDatabase(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const versions = new Map<string, number>();
  const fake = {
    db: { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), runTransaction },
    commits: [] as string[][],
    attempts: 0,
    beforeTransaction: undefined as (() => void) | undefined,
    beforeCommit: undefined as (() => void) | undefined,
    get: (path: string) => records.has(path) ? { ...records.get(path) } : undefined,
    set(path: string, value: Data) {
      records.set(path, { ...value });
      versions.set(path, (versions.get(path) ?? 0) + 1);
    },
    patch(path: string, value: Data) { fake.set(path, { ...records.get(path), ...value }); },
    remove(path: string) {
      records.delete(path);
      versions.set(path, (versions.get(path) ?? 0) + 1);
    },
  };
  function snapshot(path: string): Snapshot {
    const value = fake.get(path);
    return { exists: value !== undefined, data: () => value };
  }
  function ref(path: string): Ref {
    return { path, get: async () => snapshot(path), collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }) };
  }
  async function runTransaction<T>(callback: (tx: {
    get(ref: Ref): Promise<Snapshot>;
    set(ref: Ref, value: Data, options?: { merge: boolean }): void;
  }) => Promise<T>): Promise<T> {
    const before = fake.beforeTransaction;
    fake.beforeTransaction = undefined;
    before?.();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fake.attempts += 1;
      const reads = new Map<string, number>();
      const writes = new Map<string, Data>();
      const result = await callback({
        get: async (document) => {
          if (writes.size) throw new Error("Transaction reads must precede writes");
          reads.set(document.path, versions.get(document.path) ?? 0);
          return snapshot(document.path);
        },
        set: (document, value, options) => {
          writes.set(document.path, options?.merge ? { ...records.get(document.path), ...value } : { ...value });
        },
      });
      const conflict = fake.beforeCommit;
      fake.beforeCommit = undefined;
      conflict?.();
      if ([...reads].some(([path, version]) => version !== (versions.get(path) ?? 0))) continue;
      for (const [path, value] of writes) fake.set(path, value);
      if (writes.size) fake.commits.push([...writes.keys()]);
      return result;
    }
    throw new Error("Transaction failed after five attempts");
  }
  return fake;
}
