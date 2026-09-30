import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedSocialAuth } from "@/lib/social-hub";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), identities: vi.fn() }));
vi.mock("@/lib/social/server", async (original) => ({
  ...await original<typeof import("@/lib/social/server")>(), identityUidsFor: mocks.identities,
}));
vi.mock("@/lib/social-hub", async (original) => ({
  ...await original<typeof import("@/lib/social-hub")>(), requireLinkedProfile: mocks.auth,
}));
vi.mock("@/lib/identity-server", () => ({ canonicalIdentityUid: async (uid: string) => uid.replace(/^old-/, "") }));

import { GET as list, POST as create } from "@/app/api/teams/[teamId]/invites/route";
import { DELETE as revoke } from "@/app/api/teams/[teamId]/invites/[inviteId]/route";
import { GET as pending } from "@/app/api/teams/invites/route";
import { POST as accept } from "@/app/api/teams/invites/accept/route";
import { POST as decline } from "@/app/api/teams/invites/decline/route";
import { POST as apply } from "@/app/api/teams/[teamId]/applications/route";
import { PATCH as review } from "@/app/api/teams/[teamId]/applications/[applicationId]/route";
import { fakeTeamInviteDatabase } from "@/lib/team-invites-test-db";

const id = "a".repeat(48);
const teamPath = "teams/team-a";
const invitePath = `teamInvites/${id}`;
const appPath = `${teamPath}/applications/application-a`;
const memberPath = `${teamPath}/members/player`;
const context = { params: Promise.resolve({ teamId: "example", inviteId: id, applicationId: "application-a" }) };

describe("team invitation API and admission contracts", () => {
  let fake: ReturnType<typeof fakeTeamInviteDatabase>;
  beforeEach(() => {
    vi.clearAllMocks();
    fake = fakeTeamInviteDatabase({
      [teamPath]: { name: "Example Team", slug: "example", visibility: "private", hidden: true, ownerUid: "owner", memberCount: 1, applicationCount: 1 },
      "teamSlugs/example": { teamId: "team-a" },
      [invitePath]: { inviteId: id, teamId: "team-a", teamName: "Example Team", senderName: "Example Owner", createdBy: "owner", status: "open", targetUid: "player", targetHandle: "player", expiresAt: Date.now() + 60_000 },
      [appPath]: { uid: "player", handle: "player", displayName: "Example Player", status: "pending", createdAt: 10 },
    });
    mocks.identities.mockImplementation(async (uid: string) => [uid, `old-${uid}`]);
    mocks.auth.mockImplementation(async (req: NextRequest) => {
      const uid = req.headers.get("authorization")?.replace("Bearer ", "") || "player";
      return { db: fake.db, authenticatedUid: uid, decoded: { uid }, profile: { uid, handle: uid, handleLower: uid }, displayName: "Example Player" } as unknown as LinkedSocialAuth;
    });
  });

  it("returns a shareable URL and minimal summary from slug-based create/list/revoke", async () => {
    const response = (await create(request("owner", "POST", {}), context))!;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, inviteUrl: `https://riftlite.test/teams/invite/${body.invite.inviteId}`, invite: { teamId: "team-a", teamName: "Example Team", targetHandle: "", status: "open" } });
    expect(Object.keys(body.invite).sort()).toEqual(["inviteId", "teamId", "teamName", "senderName", "targetHandle", "status", "expiresAt", "createdAt"].sort());
    expect((await list(request("owner", "GET"), context))!.status).toBe(200);
    const revoked = await revoke(request("owner", "DELETE"), { params: Promise.resolve({ teamId: "example", inviteId: body.invite.inviteId }) });
    expect(revoked!.status).toBe(200);
    expect(fake.get(`teamInvites/${body.invite.inviteId}`)?.status).toBe("revoked");
  });

  it("returns targeted pending invitations and accepts with the agreed membership shape", async () => {
    expect(await (await pending(request("player", "GET")))!.json()).toMatchObject({ ok: true, invites: [{ inviteId: id, teamId: "team-a" }] });
    const response = (await accept(request("player", "POST", { inviteId: id })))!;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyMember: false, team: { id: "team-a", name: "Example Team", slug: "example", role: "member" } });
    expect(await (await pending(request("player", "GET")))!.json()).toMatchObject({ invites: [] });
  });

  it("returns a stable denial for non-target accounts and lets the intended player decline", async () => {
    const response = (await accept(request("other", "POST", { inviteId: id })))!;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "wrong_profile" });
    expect((await decline(request("player", "POST", { inviteId: id })))!.status).toBe(200);
    expect(fake.get(invitePath)?.status).toBe("declined");
  });

  it("requires linked authentication on every new invitation endpoint", async () => {
    mocks.auth.mockResolvedValue({ error: Response.json({ error: "Sign in" }, { status: 401 }) });
    const responses = await Promise.all([
      create(request("", "POST", {}), context), list(request("", "GET"), context), revoke(request("", "DELETE"), context),
      pending(request("", "GET")), accept(request("", "POST", { inviteId: id })), decline(request("", "POST", { inviteId: id })),
    ]);
    expect(responses.map((response) => response!.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(fake.commits).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  it.each([
    { visibility: "private", recruitmentStatus: "open" },
    { visibility: "public", recruitmentStatus: "invite-only" },
    { visibility: "public", recruitmentStatus: "closed" },
  ])("rejects unsolicited applications to %j", async (settings) => {
    fake.patch(teamPath, settings);
    const response = (await apply(request("outsider", "POST", { message: "Let me in" }), context))!;
    expect(response.status).toBe(400);
    expect(fake.commits).toEqual([]);
  });

  it("preserves alias admin roles and membership count when an existing application is accepted after joining", async () => {
    fake.set(`${teamPath}/members/old-player`, { role: "admin", joinedAt: 123 });
    fake.patch(teamPath, { memberCount: 2 });
    const response = (await review(request("owner", "PATCH", { status: "accepted" }), context))!;
    expect(response.status).toBe(200);
    expect(fake.get(memberPath)).toBeUndefined();
    expect(fake.get(`${teamPath}/members/old-player`)).toEqual({ role: "admin", joinedAt: 123 });
    expect(fake.get(teamPath)).toMatchObject({ memberCount: 2, applicationCount: 0 });
    expect((await review(request("owner", "PATCH", { status: "accepted" }), context))!.status).toBe(409);
    expect(fake.get(teamPath)?.memberCount).toBe(2);
  });

  it("serializes invitation and application acceptance for the same account", async () => {
    const responses = await Promise.all([
      accept(request("player", "POST", { inviteId: id })), review(request("owner", "PATCH", { status: "accepted" }), context),
    ]);
    expect(responses.map((response) => response!.status)).toEqual([200, 200]);
    expect(fake.get(teamPath)).toMatchObject({ memberCount: 2, applicationCount: 0 });
    expect(fake.get(memberPath)?.role).toBe("member");
    expect(fake.get(appPath)?.status).toBe("accepted");
  });

  it("only reviews a pending application once under concurrent admin requests", async () => {
    const responses = await Promise.all([
      review(request("owner", "PATCH", { status: "accepted" }), context), review(request("owner", "PATCH", { status: "accepted" }), context),
    ]);
    expect(responses.map((response) => response!.status).sort()).toEqual([200, 409]);
    expect(fake.get(teamPath)).toMatchObject({ memberCount: 2, applicationCount: 0 });
  });

  it("canonicalizes legacy applicants before adding their membership", async () => {
    fake.patch(appPath, { uid: "old-player" });
    expect((await review(request("owner", "PATCH", { status: "accepted" }), context))!.status).toBe(200);
    expect(fake.get(memberPath)?.uid).toBe("player");
    expect(fake.get(`${teamPath}/members/old-player`)).toBeUndefined();
  });

  it("denies non-admin application review without exposing its contents", async () => {
    const response = (await review(request("outsider", "PATCH", { status: "accepted" }), context))!;
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("application");
    expect(fake.get(appPath)?.status).toBe("pending");
    expect(fake.commits).toEqual([]);
  });
});

function request(uid: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest("https://riftlite.test/api/teams/example/invites", {
    method, headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
