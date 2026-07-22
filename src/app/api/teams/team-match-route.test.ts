import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertTeamRole: vi.fn(),
  identityUidsFor: vi.fn(),
  requireLinkedProfile: vi.fn(),
  resolveTeamRef: vi.fn(),
}));

vi.mock("@/lib/community/data", () => ({
  normalizeMatch: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
}));

vi.mock("@/lib/social-hub", () => ({
  assertTeamRole: mocks.assertTeamRole,
  parseBody: async (request: Request) => request.json(),
  requireLinkedProfile: mocks.requireLinkedProfile,
  resolveTeamRef: mocks.resolveTeamRef,
  socialJson: (body: Record<string, unknown>, status = 200) => Response.json(body, { status }),
}));

vi.mock("@/lib/social/server", () => ({
  identityUidsFor: mocks.identityUidsFor,
}));

import {
  DELETE as deleteTeamMatch,
  PATCH as saveTeamMatch,
} from "@/app/api/teams/[teamId]/matches/[matchId]/route";

describe("team match ownership route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTeamRole.mockResolvedValue("member");
    mocks.identityUidsFor.mockResolvedValue(["account-b"]);
  });

  it("does not let another member overwrite and reassign an existing match ID", async () => {
    const fake = fakeDatabase({
      "teams/team-a/matches/match-a": {
        id: "match-a",
        owner_uid: "account-a",
        uid: "account-a",
        created_at: 100,
        result: "win",
      },
    });
    useAuth(fake, "account-b");

    const response = (await saveTeamMatch(
      request("PATCH", { match: { result: "loss" } }),
      context(),
    ))!;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "match_owner_conflict" });
    expect(fake.read("teams/team-a/matches/match-a")).toMatchObject({
      owner_uid: "account-a",
      uid: "account-a",
      result: "win",
    });
    expect(fake.writes).toEqual([]);
  });

  it("allows an idempotent same-owner update without changing ownership or creation time", async () => {
    const fake = fakeDatabase({
      "teams/team-a/matches/match-a": {
        id: "match-a",
        owner_uid: "account-b",
        uid: "account-b",
        owner_handle: "original",
        owner_display_name: "Original Player",
        username: "Original Player",
        created_at: 100,
        result: "pending",
      },
    });
    useAuth(fake, "account-b");

    const response = (await saveTeamMatch(
      request("PATCH", {
        match: {
          owner_uid: "attempted-owner",
          uid: "attempted-owner",
          owner_handle: "attempted",
          created_at: 999,
          result: "win",
        },
      }),
      context(),
    ))!;

    expect(response.status).toBe(200);
    expect(fake.read("teams/team-a/matches/match-a")).toMatchObject({
      owner_uid: "account-b",
      uid: "account-b",
      owner_handle: "original",
      created_at: 100,
      result: "win",
    });
  });

  it("recognizes a proven desktop alias for both update and delete", async () => {
    const fake = fakeDatabase({
      "teams/team-a/matches/match-a": {
        id: "match-a",
        owner_uid: "desktop-b",
        uid: "desktop-b",
        created_at: 100,
        result: "pending",
      },
    });
    useAuth(fake, "account-b");
    mocks.identityUidsFor.mockResolvedValue(["account-b", "desktop-b"]);

    const updateResponse = (await saveTeamMatch(
      request("PATCH", { match: { result: "win" } }),
      context(),
    ))!;
    expect(updateResponse.status).toBe(200);
    expect(fake.read("teams/team-a/matches/match-a")).toMatchObject({
      owner_uid: "desktop-b",
      result: "win",
    });

    const deleteResponse = (await deleteTeamMatch(request("DELETE"), context()))!;
    expect(deleteResponse.status).toBe(200);
    expect(fake.read("teams/team-a/matches/match-a")).toBeUndefined();
  });

  it("does not let another member delete an existing uploader's match", async () => {
    const fake = fakeDatabase({
      "teams/team-a/matches/match-a": {
        id: "match-a",
        owner_uid: "account-a",
        uid: "account-a",
      },
    });
    useAuth(fake, "account-b");

    const response = (await deleteTeamMatch(request("DELETE"), context()))!;

    expect(response.status).toBe(403);
    expect(fake.read("teams/team-a/matches/match-a")).toMatchObject({ owner_uid: "account-a" });
  });

  it("lets a team admin correct a match without taking ownership from its uploader", async () => {
    const fake = fakeDatabase({
      "teams/team-a/matches/match-a": {
        id: "match-a",
        owner_uid: "account-a",
        uid: "account-a",
        owner_handle: "player-a",
        created_at: 100,
      },
    });
    useAuth(fake, "account-b");
    mocks.assertTeamRole.mockResolvedValue("admin");

    const response = (await saveTeamMatch(
      request("PATCH", { match: { notes: "Corrected by admin" } }),
      context(),
    ))!;

    expect(response.status).toBe(200);
    expect(fake.read("teams/team-a/matches/match-a")).toMatchObject({
      owner_uid: "account-a",
      uid: "account-a",
      owner_handle: "player-a",
      notes: "Corrected by admin",
    });
  });
});

function request(method: "PATCH" | "DELETE", body?: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/teams/team-a/matches/match-a", {
    method,
    headers: {
      authorization: "Bearer token",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function context() {
  return { params: Promise.resolve({ teamId: "team-a", matchId: "match-a" }) };
}

function useAuth(fake: ReturnType<typeof fakeDatabase>, uid: string): void {
  mocks.requireLinkedProfile.mockResolvedValue({
    db: fake.db,
    decoded: { uid },
    profile: { handle: `${uid}-handle` },
    displayName: `${uid} player`,
  });
  mocks.resolveTeamRef.mockResolvedValue(fake.teamSnap);
}

function fakeDatabase(initial: Record<string, Record<string, unknown>>) {
  type Ref = {
    path: string;
    collection: (name: string) => { doc: (id: string) => Ref };
  };
  const records = new Map(Object.entries(initial).map(([path, value]) => [path, { ...value }]));
  const writes: string[] = [];
  const ref = (path: string): Ref => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const teamRef = ref("teams/team-a");
  const snapshot = (target: Ref) => ({
    exists: records.has(target.path),
    data: () => records.get(target.path) ? { ...records.get(target.path)! } : undefined,
  });
  const db = {
    runTransaction: async <T>(callback: (tx: {
      get: (target: Ref) => Promise<ReturnType<typeof snapshot>>;
      set: (target: Ref, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
      delete: (target: Ref) => void;
    }) => Promise<T>) => callback({
      get: async (target) => snapshot(target),
      set: (target, data, options) => {
        const previous = options?.merge ? records.get(target.path) ?? {} : {};
        records.set(target.path, { ...previous, ...data });
        writes.push(`set:${target.path}`);
      },
      delete: (target) => {
        records.delete(target.path);
        writes.push(`delete:${target.path}`);
      },
    }),
  };
  return {
    db,
    writes,
    teamSnap: {
      id: "team-a",
      ref: teamRef,
      data: () => ({ slug: "team-a", name: "Team A" }),
    },
    read: (path: string) => records.get(path),
  };
}
