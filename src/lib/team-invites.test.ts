import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedSocialAuth } from "@/lib/social-hub";

const mocks = vi.hoisted(() => ({ identities: vi.fn() }));
vi.mock("@/lib/social/server", async (original) => ({
  ...await original<typeof import("@/lib/social/server")>(), identityUidsFor: mocks.identities,
}));

import {
  acceptTeamInvite, createTeamInvite, declineTeamInvite, listTargetedTeamInvites, listTeamInvites,
  loadTeamInviteSummary, revokeTeamInvite,
} from "@/lib/team-invites";
import { fakeTeamInviteDatabase } from "@/lib/team-invites-test-db";

const id = "a".repeat(48);
const invitePath = `teamInvites/${id}`;
const teamPath = "teams/team-a";
const memberPath = `${teamPath}/members/player`;

describe("team invitations", () => {
  let fake: ReturnType<typeof fakeTeamInviteDatabase>;
  const auth = (uid = "player") => ({
    db: fake.db, authenticatedUid: uid, decoded: { uid }, displayName: "Example Player",
    profile: { uid, handle: uid, handleLower: uid },
  } as unknown as LinkedSocialAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identities.mockImplementation(async (uid: string) => [uid, `old-${uid}`]);
    fake = fakeTeamInviteDatabase({
      [teamPath]: { name: "Example Team", slug: "example", ownerUid: "owner", visibility: "private", hidden: true, memberCount: 1 },
      "teamSlugs/example": { teamId: "team-a" },
      [invitePath]: {
        inviteId: id, teamId: "team-a", teamName: "Example Team", senderName: "Example Owner", createdBy: "owner",
        targetUid: "", targetHandle: "", status: "open", expiresAt: Date.now() + 60_000, createdAt: 123,
      },
    });
  });

  it("creates a 24-byte single-use invitation valid for 14 days using a team slug", async () => {
    const now = Date.now();
    const result = await createTeamInvite(auth("owner"), "example", "");
    expect(result.invite.inviteId).toMatch(/^[a-f0-9]{48}$/);
    expect(result.invite).toMatchObject({ teamId: "team-a", teamName: "Example Team", senderName: "Example Player", status: "open" });
    expect(result.invite.expiresAt).toBeGreaterThanOrEqual(now + 14 * 86_400_000);
    expect(result.invite).not.toHaveProperty("createdBy");
    expect(result.invite).not.toHaveProperty("targetUid");
    expect(fake.get(`teamInvites/${result.invite.inviteId}`)?.createdBy).toBe("owner");
  });

  it("allows a validated alias admin to create an invitation", async () => {
    fake.set(`${teamPath}/members/old-player`, { role: "admin" });
    expect((await createTeamInvite(auth(), "team-a", "")).ok).toBe(true);
  });

  it.each(["", "member"])("denies invitation management to role '%s'", async (role) => {
    if (role) fake.set(memberPath, { role });
    await expect(createTeamInvite(auth(), "team-a", "")).rejects.toMatchObject({ status: 403 });
    await expect(listTeamInvites(auth(), "team-a")).rejects.toMatchObject({ status: 403 });
    await expect(revokeTeamInvite(auth(), "team-a", id)).rejects.toMatchObject({ status: 403 });
    expect(fake.commits).toEqual([]);
  });

  it("requires a real target handle and rejects already-joined aliases", async () => {
    await expect(createTeamInvite(auth("owner"), "team-a", "@missing")).rejects.toMatchObject({ code: "profile_not_found" });
    await expect(createTeamInvite(auth("owner"), "team-a", "bad handle")).rejects.toMatchObject({ code: "invalid_handle" });
    fake.set("handles/player", { uid: "player" });
    fake.set(`${teamPath}/members/old-player`, { role: "member" });
    await expect(createTeamInvite(auth("owner"), "team-a", "@player")).rejects.toMatchObject({ code: "already_member" });
  });

  it("joins once atomically and keeps private team details out of publicTeams", async () => {
    const result = await acceptTeamInvite(auth(), id);
    expect(result).toEqual({ ok: true, alreadyMember: false, team: { id: "team-a", name: "Example Team", slug: "example", role: "member" } });
    expect(fake.get(memberPath)).toMatchObject({ uid: "player", role: "member" });
    expect(fake.get(teamPath)?.memberCount).toBe(2);
    expect(fake.get(invitePath)).toMatchObject({ status: "accepted", acceptedBy: "player" });
    expect(fake.get("publicTeams/team-a")).toBeUndefined();
    expect(fake.commits).toHaveLength(1);
    expect((await acceptTeamInvite(auth(), id)).alreadyMember).toBe(true);
    expect(fake.get(teamPath)?.memberCount).toBe(2);
    expect(fake.commits).toHaveLength(1);
  });

  it("updates a public team's count in the same transaction", async () => {
    fake.patch(teamPath, { visibility: "public", hidden: false });
    await acceptTeamInvite(auth(), id);
    expect(fake.get("publicTeams/team-a")?.memberCount).toBe(2);
    expect(fake.commits[0]).toContain("publicTeams/team-a");
  });

  it.each(["member", "admin", "owner"])("does not consume an open invite or downgrade an existing alias %s", async (role) => {
    fake.set(`${teamPath}/members/old-player`, { role, joinedAt: 10 });
    const result = await acceptTeamInvite(auth(), id);
    expect(result).toMatchObject({ alreadyMember: true, team: { role } });
    expect(fake.get(invitePath)?.status).toBe("open");
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.get(teamPath)?.memberCount).toBe(1);
    expect(fake.commits).toEqual([]);
  });

  it("recognizes authoritative ownership despite a downgraded member document", async () => {
    fake.set(`${teamPath}/members/owner`, { role: "member" });
    expect(await acceptTeamInvite(auth("owner"), id)).toMatchObject({ alreadyMember: true, team: { role: "owner" } });
    expect(fake.commits).toEqual([]);
  });

  it("recognizes the highest role over all validated identities", async () => {
    fake.set(memberPath, { role: "member" });
    fake.set(`${teamPath}/members/old-player`, { role: "admin" });
    expect(await acceptTeamInvite(auth(), id)).toMatchObject({ alreadyMember: true, team: { role: "admin" } });
  });

  it("never restores removed membership from an accepted invitation", async () => {
    fake.patch(invitePath, { status: "accepted", acceptedBy: "old-player" });
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "invite_closed" });
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.commits).toEqual([]);
  });

  it.each([{ status: "revoked" }, { status: "declined" }, { status: "accepted", acceptedBy: "other" }])("rejects closed invitations: %j", async (patch) => {
    fake.patch(invitePath, patch);
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "invite_closed" });
    expect(fake.commits).toEqual([]);
  });

  it.each([0, Number.NaN, Date.now() - 1])("rejects invalid/expired expiry %s", async (expiresAt) => {
    fake.patch(invitePath, { expiresAt });
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "invite_expired" });
  });

  it.each([{ lifecycle_state: "deleting" }, { deletedAt: 1 }, { moderationStatus: "hidden" }])("blocks unavailable teams: %j", async (patch) => {
    fake.patch(teamPath, patch);
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "team_unavailable" });
    expect((await loadTeamInviteSummary(id, fake.db)).found).toBe(false);
  });

  it("blocks a deleted team", async () => {
    fake.remove(teamPath);
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "team_unavailable" });
  });

  it.each(["missing", "member"])("blocks an inviter whose current role is %s", async (role) => {
    fake.patch(invitePath, { createdBy: "sender" });
    if (role !== "missing") fake.set(`${teamPath}/members/sender`, { role });
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "inviter_unavailable" });
    expect(fake.commits).toEqual([]);
  });

  it("accepts an invitation created by an admin's validated old identity", async () => {
    fake.patch(invitePath, { createdBy: "sender" });
    fake.set(`${teamPath}/members/old-sender`, { role: "admin" });
    expect((await acceptTeamInvite(auth(), id)).alreadyMember).toBe(false);
  });

  it("enforces targeted invitations and accepts validated aliases", async () => {
    fake.patch(invitePath, { targetUid: "old-player", targetHandle: "obsolete-handle" });
    await expect(acceptTeamInvite(auth("outsider"), id)).rejects.toMatchObject({ code: "wrong_profile" });
    expect((await acceptTeamInvite(auth(), id)).alreadyMember).toBe(false);
  });

  it("does not let even the owner consume an invitation reserved for another account", async () => {
    fake.patch(invitePath, { targetUid: "player" });
    await expect(acceptTeamInvite(auth("owner"), id)).rejects.toMatchObject({ code: "wrong_profile" });
  });

  it("allows only the target to decline and never consumes a generic invite through decline", async () => {
    await expect(declineTeamInvite(auth(), id)).rejects.toMatchObject({ code: "target_required" });
    fake.patch(invitePath, { targetUid: "old-player" });
    await expect(declineTeamInvite(auth("outsider"), id)).rejects.toMatchObject({ code: "wrong_profile" });
    await declineTeamInvite(auth(), id);
    await declineTeamInvite(auth(), id);
    expect(fake.get(invitePath)?.status).toBe("declined");
    expect(fake.commits).toHaveLength(1);
  });

  it("revokes only invitations for the selected team and keeps revocation idempotent", async () => {
    fake.patch(invitePath, { teamId: "other-team" });
    await expect(revokeTeamInvite(auth("owner"), "example", id)).rejects.toMatchObject({ code: "invite_not_found" });
    fake.patch(invitePath, { teamId: "team-a" });
    await revokeTeamInvite(auth("owner"), "example", id);
    await revokeTeamInvite(auth("owner"), "example", id);
    expect(fake.get(invitePath)?.status).toBe("revoked");
    expect(fake.commits).toHaveLength(1);
  });

  it("shows only safe public metadata from the bearer link", async () => {
    fake.patch(invitePath, { targetUid: "secret-uid", targetHandle: "player", email: "private@example.com", members: ["secret"] });
    fake.patch(teamPath, { matches: [{ opponent: "Secret Player" }], memberUids: ["secret-uid"] });
    expect(await loadTeamInviteSummary(id, fake.db)).toEqual({
      found: true, inviteId: id, teamName: "Example Team", senderName: "Example Owner", targetHandle: "player",
      status: "open", expiresAt: fake.get(invitePath)?.expiresAt,
    });
    expect((await loadTeamInviteSummary("not-a-token", fake.db)).found).toBe(false);
  });

  it("lists only current open targeted invitations across proven identities with bounded queries", async () => {
    fake.patch(invitePath, { targetUid: "old-player", targetHandle: "player" });
    for (const [letter, patch] of [["b", { targetUid: "someone-else" }], ["c", { targetUid: "player", status: "accepted" }], ["d", { targetUid: "player", expiresAt: 1 }]] as const) {
      fake.set(`teamInvites/${letter.repeat(48)}`, { ...fake.get(invitePath), ...patch });
    }
    const result = await listTargetedTeamInvites(auth());
    expect(result.invites.map((invite) => invite.inviteId)).toEqual([id]);
    expect(result.invites[0]).not.toHaveProperty("targetUid");
    expect(fake.queries).toMatchObject([{ filters: [["targetUid", "in", ["player", "old-player"]], ["status", "==", "open"], ["expiresAt", ">", expect.any(Number)]], cap: 50 }]);
  });

  it("lists pending invitations for admins without exposing internal identities", async () => {
    const result = await listTeamInvites(auth("owner"), "example");
    expect(result.invites).toHaveLength(1);
    expect(result.invites[0]).not.toHaveProperty("createdBy");
    expect(result.invites[0]).not.toHaveProperty("targetUid");
  });

  it("keeps recent pending invitations discoverable after hundreds of historical records", async () => {
    fake.remove(invitePath);
    for (let index = 0; index < 240; index += 1) {
      fake.set(`teamInvites/${index.toString(16).padStart(48, "0")}`, {
        teamId: "team-a", targetUid: "player", status: index % 2 ? "accepted" : "open", expiresAt: 1,
      });
    }
    fake.set(invitePath, { teamId: "team-a", targetUid: "player", status: "open", expiresAt: Date.now() + 60_000 });
    expect((await listTeamInvites(auth("owner"), "example")).invites.map((invite) => invite.inviteId)).toEqual([id]);
    expect((await listTargetedTeamInvites(auth())).invites.map((invite) => invite.inviteId)).toEqual([id]);
  });

  it("serializes two users racing to accept one invitation", async () => {
    const results = await Promise.allSettled([acceptTeamInvite(auth(), id), acceptTeamInvite(auth("other-player"), id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fake.get(teamPath)?.memberCount).toBe(2);
    expect(fake.commits).toHaveLength(1);
  });

  it("serializes one user accepting two invitations without double-counting membership", async () => {
    const other = "b".repeat(48);
    fake.set(`teamInvites/${other}`, { ...fake.get(invitePath), inviteId: other });
    const results = await Promise.all([acceptTeamInvite(auth(), id), acceptTeamInvite(auth(), other)]);
    expect(results.map((result) => result.alreadyMember).sort()).toEqual([false, true]);
    expect(fake.get(teamPath)?.memberCount).toBe(2);
    expect(fake.commits).toHaveLength(1);
  });

  it("rechecks inviter authorization against a simultaneous removal", async () => {
    fake.patch(invitePath, { createdBy: "sender" });
    fake.set(`${teamPath}/members/sender`, { role: "admin" });
    fake.beforeCommit = () => fake.remove(`${teamPath}/members/sender`);
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "inviter_unavailable" });
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.commits).toEqual([]);
  });

  it("rechecks invitation revocation before committing membership", async () => {
    fake.beforeCommit = () => fake.patch(invitePath, { status: "revoked" });
    await expect(acceptTeamInvite(auth(), id)).rejects.toMatchObject({ code: "invite_closed" });
    expect(fake.commits).toEqual([]);
  });
});
