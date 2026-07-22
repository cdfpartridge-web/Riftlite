import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertTeamRole: vi.fn(),
  findMembershipDocuments: vi.fn(),
  identityUidsFor: vi.fn(),
  requireLinkedProfile: vi.fn(),
  resolveTeamRef: vi.fn(),
}));

vi.mock("@/lib/community/data", () => ({
  normalizeMatch: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
}));

vi.mock("@/lib/social/server", () => ({
  findMembershipDocuments: mocks.findMembershipDocuments,
  identityUidsFor: mocks.identityUidsFor,
}));

vi.mock("@/lib/social-hub", () => ({
  assertTeamRole: mocks.assertTeamRole,
  cleanList: () => [],
  cleanLongText: (value: unknown) => String(value ?? ""),
  cleanSlug: (value: unknown) => String(value ?? ""),
  cleanTeamVisibility: (value: unknown) => value === "private" ? "private" : "public",
  cleanText: (value: unknown) => String(value ?? ""),
  cleanUrl: (value: unknown) => String(value ?? ""),
  fullTeamFromDoc: (id: string, data: Record<string, unknown>) => ({
    id,
    slug: String(data.slug ?? id),
    name: String(data.name ?? id),
    visibility: data.visibility === "private" ? "private" : "public",
    ownerUid: String(data.ownerUid ?? ""),
    updatedAt: Number(data.updatedAt ?? 0),
  }),
  newId: () => "new-team",
  parseBody: async (request: Request) => request.json(),
  publicTeamFromDoc: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
  requireLinkedProfile: mocks.requireLinkedProfile,
  resolveTeamRef: mocks.resolveTeamRef,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
  teamPublicDoc: (team: Record<string, unknown>) => team,
  validSlug: () => true,
}));

import { GET as getTeam } from "@/app/api/teams/[teamId]/route";
import { GET as getTeamMatches } from "@/app/api/teams/[teamId]/matches/route";
import { GET as getTeams } from "@/app/api/teams/route";

describe("alias-resilient team routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identityUidsFor.mockResolvedValue(["account-a", "desktop-a"]);
    mocks.assertTeamRole.mockResolvedValue("member");
  });

  it("lists a private team found through a proven desktop-alias membership", async () => {
    const fake = fakeTeamDatabase();
    mocks.requireLinkedProfile.mockResolvedValue(auth(fake.db));
    mocks.findMembershipDocuments.mockResolvedValue([{
      ref: {
        parent: { parent: fake.teamRef },
      },
      data: () => ({ uid: "desktop-a", role: "member" }),
    }]);

    const response = (await getTeams(new NextRequest("http://localhost/api/teams?mine=1")))!;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      teams: [expect.objectContaining({ id: "team-a", name: "Alias Team" })],
    });
    expect(mocks.identityUidsFor).toHaveBeenCalledWith("account-a", fake.db);
    expect(mocks.findMembershipDocuments).toHaveBeenCalledWith(
      fake.db,
      ["account-a", "desktop-a"],
      "teams",
    );
  });

  it("uses the alias-aware role for private team detail and reports the strongest role", async () => {
    const fake = fakeTeamDatabase();
    mocks.requireLinkedProfile.mockResolvedValue(auth(fake.db));
    mocks.resolveTeamRef.mockResolvedValue(fake.teamSnap);
    mocks.assertTeamRole.mockResolvedValue("admin");

    const response = (await getTeam(
      new NextRequest("http://localhost/api/teams/team-a"),
      context(),
    ))!;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ myRole: "admin" });
    expect(mocks.assertTeamRole).toHaveBeenCalledWith(
      "team-a",
      "account-a",
      ["owner", "admin", "member"],
    );
  });

  it("allows a proven alias member to read private team matches", async () => {
    const fake = fakeTeamDatabase();
    mocks.requireLinkedProfile.mockResolvedValue(auth(fake.db));
    mocks.resolveTeamRef.mockResolvedValue(fake.teamSnap);

    const response = (await getTeamMatches(
      new NextRequest("http://localhost/api/teams/team-a/matches"),
      context(),
    ))!;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 1, teamId: "team-a" });
    expect(mocks.assertTeamRole).toHaveBeenCalledWith(
      "team-a",
      "account-a",
      ["owner", "admin", "member"],
    );
  });

  it("still rejects a private-team request when no associated identity has a role", async () => {
    const fake = fakeTeamDatabase();
    mocks.requireLinkedProfile.mockResolvedValue(auth(fake.db));
    mocks.resolveTeamRef.mockResolvedValue(fake.teamSnap);
    mocks.assertTeamRole.mockRejectedValue(new Error("not a member"));

    const response = (await getTeamMatches(
      new NextRequest("http://localhost/api/teams/team-a/matches"),
      context(),
    ))!;

    expect(response.status).toBe(403);
  });
});

function auth(db: ReturnType<typeof fakeTeamDatabase>["db"]) {
  return {
    db,
    decoded: { uid: "account-a" },
    profile: { handle: "player-a" },
    displayName: "Player A",
  };
}

function context() {
  return { params: Promise.resolve({ teamId: "team-a" }) };
}

function fakeTeamDatabase() {
  type TeamRef = {
    id: string;
    parent: { id: string };
    collection: (name: string) => Record<string, unknown>;
  };
  const memberDocs = [{
    id: "desktop-a",
    data: () => ({ uid: "desktop-a", role: "member", joinedAt: 1 }),
  }];
  const matchDocs = [{
    id: "match-a",
    data: () => ({ uid: "desktop-a", created_at: 2, result: "win" }),
  }];
  const teamRef: TeamRef = {
    id: "team-a",
    parent: { id: "teams" },
    collection: (name: string) => {
      if (name === "members") {
        return {
          orderBy: () => ({ limit: () => ({ get: async () => ({ docs: memberDocs }) }) }),
        };
      }
      if (name === "matches") {
        return {
          orderBy: () => ({ limit: () => ({ get: async () => ({ docs: matchDocs }) }) }),
        };
      }
      return {};
    },
  };
  const teamSnap = {
    id: "team-a",
    exists: true,
    ref: teamRef,
    data: () => ({
      id: "team-a",
      slug: "alias-team",
      name: "Alias Team",
      visibility: "private",
      ownerUid: "desktop-owner",
      updatedAt: 10,
    }),
  };
  const db = {
    collection: (name: string) => {
      if (name !== "teams") return {};
      return {
        where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
      };
    },
    getAll: async (...refs: unknown[]) => refs.map(() => teamSnap),
  };
  return { db, teamRef, teamSnap };
}
