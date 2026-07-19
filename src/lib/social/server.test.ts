import { describe, expect, it } from "vitest";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";

import {
  buildSearchPrefixes,
  buildUserAggregate,
  bestProfileDisplayName,
  claimLinkedIdentityAssociation,
  cleanDisplayName,
  cleanHandle,
  decodeMatches,
  encodeMatches,
  findMembershipDocuments,
  handleLower,
  hubIdentityMigrationPatch,
  hubRecordOwnedByIdentity,
  identityUidsFor,
  LinkedIdentityConflictError,
  normalizeAccountProfile,
  publicProfileFromAccount,
  repairHistoricalDesktopIdentityAssociations,
  profileIsComplete,
  repairCachedProfileMatch,
  validHandle,
} from "@/lib/social/server";
import type { CommunityMatch } from "@/lib/types";

function match(id: string, result: CommunityMatch["result"], myChampion: string, createdAt: number): CommunityMatch {
  return {
    id,
    uid: "uid-1",
    username: "BMU",
    date: "",
    result,
    myChampion,
    oppChampion: "Jinx",
    oppName: "Tester",
    fmt: "Bo1",
    score: "1-0",
    wentFirst: "Went 1st",
    myBattlefield: "The Papertree",
    oppBattlefield: "Sunken Temple",
    flags: "",
    games: [],
    deckName: "",
    deckSourceUrl: "",
    deckSourceKey: "",
    deckSnapshot: null,
    createdAt,
  };
}

describe("social profile helpers", () => {
  it("cleans and validates public handles without accepting unsafe characters", () => {
    expect(cleanHandle("@BMU Casts!!")).toBe("BMUCasts");
    expect(cleanHandle("abcdefghijklmnopqrstuvwxyzzz")).toHaveLength(24);
    expect(handleLower("BMU_Casts")).toBe("bmu_casts");
    expect(validHandle("BMU")).toBe(true);
    expect(validHandle("bmu-casts_01")).toBe(true);
    expect(validHandle("ab")).toBe(false);
    expect(validHandle("-bad")).toBe(false);
    expect(cleanDisplayName("  BMU    Casts  ")).toBe("BMU Casts");
  });

  it("builds searchable public profile docs only from opted-in account data", () => {
    const profile = normalizeAccountProfile("uid-1", {
      email: "bmu@example.com",
      handle: "BMUCasts",
      displayName: "BMU Casts",
      publicProfile: true,
      searchable: true,
      showStats: true,
      showMatches: false,
      showDecks: false,
      showHubBadges: true,
      marketingConsent: true,
      marketingConsentAt: 100,
      marketingConsentVersion: "test-consent",
      marketingConsentSource: "test",
      createdAt: 10,
      updatedAt: 20,
    });
    const publicProfile = publicProfileFromAccount(profile);

    expect(publicProfile.uid).toBe("uid-1");
    expect("email" in publicProfile).toBe(false);
    expect("marketingConsent" in publicProfile).toBe(false);
    expect(profile.email).toBe("bmu@example.com");
    expect(profile.marketingConsent).toBe(true);
    expect(publicProfile.handleLower).toBe("bmucasts");
    expect(publicProfile.searchable).toBe(true);
    expect(publicProfile.showMatches).toBe(false);
    expect(publicProfile.showHubBadges).toBe(true);
    expect(publicProfile.searchPrefixes).toEqual(expect.arrayContaining(["b", "bmu", "cas", "casts"]));
  });

  it("compresses public match windows and builds user aggregates without raw scans", () => {
    const profile = normalizeAccountProfile("uid-1", {
      handle: "BMUCasts",
      displayName: "BMU Casts",
    });
    const matches = [
      match("m1", "Win", "Vex", 3),
      match("m2", "Loss", "Vex", 2),
      match("m3", "Draw", "Annie", 1),
    ];
    const encoded = encodeMatches(matches);

    expect(decodeMatches(encoded)).toEqual(matches);
    expect(decodeMatches("not valid")).toEqual([]);

    const aggregate = buildUserAggregate(profile, matches);
    expect(aggregate.totalMatches).toBe(3);
    expect(aggregate.wins).toBe(1);
    expect(aggregate.losses).toBe(1);
    expect(aggregate.draws).toBe(1);
    expect(aggregate.winRate).toBe(50);
    expect(aggregate.topLegend).toBe("Vex");
    expect(aggregate.recentMatches).toHaveLength(3);
  });

  it("treats the generic RiftLite Player name as missing and repairs from handle", () => {
    const profile = normalizeAccountProfile("uid-abcdef", {
      handle: "BMU",
      displayName: "RiftLite Player",
    });

    expect(cleanDisplayName("RiftLite Player", "BMU", "uid-abcdef")).toBe("BMU");
    expect(profile.displayName).toBe("BMU");
  });

  it("requires a chosen name and valid handle before social onboarding is complete", () => {
    expect(profileIsComplete({ handle: "BMU", displayName: "BMU" })).toBe(true);
    expect(profileIsComplete({ handle: "", displayName: "BMU" })).toBe(false);
    expect(profileIsComplete({ handle: "BMU", displayName: "Player#abc123" })).toBe(false);
    expect(profileIsComplete({ handle: "BMU", displayName: "player@example.com" })).toBe(false);
  });

  it("uses created_by as ownership only before a hub becomes account-managed", () => {
    expect(hubRecordOwnedByIdentity({ created_by: "legacy-owner" }, ["legacy-owner"])).toBe(true);
    expect(hubRecordOwnedByIdentity({
      role_mode: "account",
      owner_uid: "current-owner",
      created_by: "legacy-owner",
    }, ["legacy-owner"])).toBe(false);
    expect(hubRecordOwnedByIdentity({
      role_mode: "account",
      owner_uid: "desktop-alias",
      created_by: "legacy-owner",
    }, ["account-owner", "desktop-alias"])).toBe(true);
  });

  it("does not overwrite an established owner while migrating an old creator UID", () => {
    expect(hubIdentityMigrationPatch({
      role_mode: "account",
      owner_uid: "current-owner",
      created_by: "desktop-alias",
    }, "created_by", "desktop-alias", "account-uid", 100)).toEqual({
      created_by: "account-uid",
      identityMigratedAt: 100,
    });
    expect(hubIdentityMigrationPatch({
      created_by: "desktop-alias",
    }, "created_by", "desktop-alias", "account-uid", 100)).toEqual({
      created_by: "account-uid",
      owner_uid: "account-uid",
      identityMigratedAt: 100,
    });
  });

  it("never exposes an email address as the social display name", () => {
    expect(bestProfileDisplayName("uid-abcdef", "player@example.com")).toBe("Player uidabc");
    expect(bestProfileDisplayName("uid-abcdef", "player@example.com", "BMU")).toBe("BMU");
  });

  it("finds UID-keyed hub memberships when the collection-group index is unavailable", async () => {
    const membershipRef = {
      path: "hubs/teamuk/members/anonymous-uid",
      parent: { parent: { parent: { id: "hubs" } } },
    };
    const membership = {
      exists: true,
      ref: membershipRef,
      data: () => ({ uid: "anonymous-uid", role: "member" }),
    } as unknown as DocumentSnapshot;
    const missing = {
      exists: false,
      ref: { ...membershipRef, path: "hubs/other/members/anonymous-uid" },
      data: () => undefined,
    } as unknown as DocumentSnapshot;
    const db = {
      collectionGroup: () => ({
        where: () => ({ get: async () => { throw new Error("missing collection-group index"); } }),
      }),
      collection: () => ({
        get: async () => ({
          docs: [
            { ref: { collection: () => ({ doc: () => membershipRef }) } },
            { ref: { collection: () => ({ doc: () => missing.ref }) } },
          ],
        }),
      }),
      getAll: async () => [membership, missing],
    } as unknown as Firestore;

    const result = await findMembershipDocuments(db, ["anonymous-uid"], "hubs");

    expect(result).toEqual([membership]);
  });

  it("repairs cached profile game rows from match-level score context", () => {
    const repaired = repairCachedProfileMatch({
      ...match("stale", "Loss", "Pyke", 4),
      score: "0-1",
      wentFirst: "1st",
      myBattlefield: "Ripper's Bay",
      oppBattlefield: "Seat of Power",
      games: [
        {
          myBf: "",
          oppBf: "",
          wentFirst: "",
          result: "Loss",
          myPoints: 0,
          oppPoints: 0,
        },
      ],
    });

    expect(repaired.games[0]).toMatchObject({
      myBf: "Ripper's Bay",
      oppBf: "Seat of Power",
      wentFirst: "1st",
      result: "Loss",
    });
  });

  it("limits profile search prefixes so profile search stays cheap", () => {
    const prefixes = buildSearchPrefixes("NoVeggies Coaching", "Riftbound Coach");
    expect(prefixes).toEqual(expect.arrayContaining(["n", "no", "noveggies", "coach"]));
    expect(prefixes.length).toBeLessThanOrEqual(80);
  });

  it("immutably binds one raw desktop identity across competing link sessions", async () => {
    const { db, read } = fakeIdentityBindingDatabase();

    const results = await Promise.allSettled([
      claimLinkedIdentityAssociation(db, "desktop-raw", "account-a", 100),
      claimLinkedIdentityAssociation(db, "desktop-raw", "account-b", 101),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(LinkedIdentityConflictError) });
    const winner = String(read("identityAliases/desktop-raw").canonicalUid ?? "");
    expect(["account-a", "account-b"]).toContain(winner);

    await expect(claimLinkedIdentityAssociation(db, "desktop-raw", winner, 102)).resolves.toBeUndefined();
    const other = winner === "account-a" ? "account-b" : "account-a";
    await expect(claimLinkedIdentityAssociation(db, "desktop-raw", other, 103))
      .rejects.toBeInstanceOf(LinkedIdentityConflictError);
  });

  it("retains and flags a conflicting historical identity instead of failing account health", async () => {
    const { db, read, seed, setLinkSessions } = fakeIdentityBindingDatabase();
    seed("identityAliases/desktop-raw", { canonicalUid: "account-a", sourceUid: "desktop-raw" });
    seed("users/desktop-raw", { canonicalUid: "account-a" });
    seed("users/account-b", {});
    setLinkSessions([{
      status: "complete",
      desktopUid: "desktop-raw",
      linkedUid: "account-b",
    }]);

    await expect(repairHistoricalDesktopIdentityAssociations("account-b", db)).resolves.toEqual([]);
    expect(read("identityAliases/desktop-raw")).toMatchObject({
      canonicalUid: "account-a",
      migrationConflictCanonicalUid: "account-a",
      migrationRequestedCanonicalUid: "account-b",
    });
    expect(read("users/account-b")).toMatchObject({
      desktopIdentityBackfilledSources: 0,
      desktopIdentityBackfillConflicts: [{
        sourceUid: "desktop-raw",
        existingCanonicalUid: "account-a",
      }],
    });
  });

  it("excludes a stale alias that is immutably bound to another canonical account", async () => {
    const documents = new Map<string, Record<string, unknown>>([
      ["users/account-a", { identityAliases: ["desktop-a", "stale-desktop"] }],
      ["users/desktop-a", { canonicalUid: "account-a" }],
      ["identityAliases/desktop-a", { canonicalUid: "account-a" }],
      ["users/stale-desktop", { canonicalUid: "account-b" }],
      ["identityAliases/stale-desktop", { canonicalUid: "account-b" }],
    ]);
    const db = {
      collection: (collectionId: string) => ({
        doc: (documentId: string) => ({
          get: async () => ({
            exists: documents.has(`${collectionId}/${documentId}`),
            data: () => documents.get(`${collectionId}/${documentId}`),
          }),
        }),
      }),
    } as unknown as Firestore;

    await expect(identityUidsFor("account-a", db)).resolves.toEqual(["account-a", "desktop-a"]);
  });
});

function fakeIdentityBindingDatabase() {
  const documents = new Map<string, Record<string, unknown>>();
  let linkSessions: Record<string, unknown>[] = [];
  const refFor = (path: string) => ({
    path,
    get: async () => ({
      exists: documents.has(path),
      data: () => documents.get(path),
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      documents.set(path, options?.merge
        ? { ...(documents.get(path) ?? {}), ...data }
        : { ...data });
    },
  });
  let transactionTail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (collectionId: string) => ({
      doc: (documentId: string) => refFor(`${collectionId}/${documentId}`),
      where: () => ({
        limit: () => ({
          get: async () => ({
            docs: linkSessions.map((data) => ({ data: () => data })),
          }),
        }),
      }),
    }),
    runTransaction: <T>(callback: (tx: {
      get: (ref: { path: string }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
      }>;
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
    }) => Promise<T>) => {
      const result = transactionTail.then(() => callback({
        get: async (ref) => ({
          exists: documents.has(ref.path),
          data: () => documents.get(ref.path),
        }),
        set: (ref, data, options) => {
          documents.set(ref.path, options?.merge
            ? { ...(documents.get(ref.path) ?? {}), ...data }
            : { ...data });
        },
      }));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    },
  } as unknown as Firestore;
  return {
    db,
    read: (path: string) => documents.get(path) ?? {},
    seed: (path: string, data: Record<string, unknown>) => documents.set(path, { ...data }),
    setLinkSessions: (sessions: Record<string, unknown>[]) => {
      linkSessions = sessions.map((session) => ({ ...session }));
    },
  };
}
