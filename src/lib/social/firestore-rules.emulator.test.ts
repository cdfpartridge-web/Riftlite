import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulatorAvailable)("Firestore security rules in the emulator", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "riftlite-rules-test",
      firestore: {
        rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  it("keeps public matches readable but makes their owner immutable", async () => {
    const owner = environment.authenticatedContext("owner-a").firestore();
    const outsider = environment.authenticatedContext("owner-b").firestore();
    const anonymous = environment.unauthenticatedContext().firestore();
    const match = doc(owner, "matches/match-1");

    await assertSucceeds(setDoc(match, { uid: "owner-a", result: "Win" }));
    await assertSucceeds(getDoc(doc(anonymous, "matches/match-1")));
    await assertFails(updateDoc(doc(outsider, "matches/match-1"), { result: "Loss" }));
    await assertFails(updateDoc(match, { uid: "owner-b" }));
    await assertSucceeds(updateDoc(match, { result: "Draw" }));
  });

  it("allows only members or owners to read and contribute their own private hub matches", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "hubs/team-uk"), {
        name: "Team UK",
        created_by: "owner-a",
        owner_uid: "owner-a",
        role_mode: "account",
        password_hash: "server-only",
      });
      await setDoc(doc(db, "hubs/team-uk/members/member-a"), { uid: "member-a", role: "member" });
      await setDoc(doc(db, "hubs/team-uk/matches/owner-match"), { uid: "owner-a", result: "Win" });
    });

    const owner = environment.authenticatedContext("owner-a").firestore();
    const member = environment.authenticatedContext("member-a").firestore();
    const outsider = environment.authenticatedContext("outsider-a").firestore();

    await assertSucceeds(getDoc(doc(owner, "hubs/team-uk")));
    await assertSucceeds(getDocs(collection(member, "hubs/team-uk/matches")));
    await assertFails(getDoc(doc(outsider, "hubs/team-uk")));
    await assertFails(getDocs(collection(outsider, "hubs/team-uk/matches")));
    await assertSucceeds(setDoc(doc(member, "hubs/team-uk/matches/member-match"), { uid: "member-a", result: "Loss" }));
    await assertFails(setDoc(doc(member, "hubs/team-uk/matches/spoofed-match"), { uid: "outsider-a", result: "Win" }));
    await assertFails(setDoc(doc(outsider, "hubs/team-uk/matches/injected-match"), { uid: "outsider-a", result: "Win" }));
  });

  it("preserves legacy password-only hub access until the hub is claimed", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "hubs/legacy-hub"), {
        name: "Legacy Hub",
        created_by: "legacy-owner",
        password_hash: "legacy-hash",
      });
      await setDoc(doc(db, "hubs/legacy-hub/matches/legacy-match"), { uid: "legacy-player" });
    });
    const signedInUser = environment.authenticatedContext("legacy-player").firestore();
    await assertSucceeds(getDoc(doc(signedInUser, "hubs/legacy-hub")));
    await assertSucceeds(getDocs(collection(signedInUser, "hubs/legacy-hub/matches")));
  });

  it("keeps membership roles server-authoritative even for the member", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "hubs/team-uk/members/member-a"), { uid: "member-a", role: "member" });
    });
    const member = environment.authenticatedContext("member-a").firestore();
    await assertFails(getDoc(doc(member, "hubs/team-uk/members/member-a")));
    await assertFails(updateDoc(doc(member, "hubs/team-uk/members/member-a"), { role: "owner" }));
  });

  it("isolates account backups by authenticated UID", async () => {
    const owner = environment.authenticatedContext("owner-a").firestore();
    const outsider = environment.authenticatedContext("owner-b").firestore();
    const manifest = doc(owner, "accountSync/owner-a/generations/generation-1");

    await assertSucceeds(setDoc(manifest, { checksum: "abc123" }));
    await assertSucceeds(getDoc(manifest));
    await assertFails(getDoc(doc(outsider, "accountSync/owner-a/generations/generation-1")));
    await assertFails(setDoc(doc(outsider, "accountSync/owner-a/generations/generation-2"), { checksum: "wrong-owner" }));
  });

  it("denies unlisted client collections", async () => {
    const user = environment.authenticatedContext("owner-a").firestore();
    await assertFails(setDoc(doc(user, "discordGuildConfigs/guild-1"), { hubId: "team-uk" }));
    await assertFails(getDoc(doc(user, "replayDiscordShares/share-1")));
  });
});
