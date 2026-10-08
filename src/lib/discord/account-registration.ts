import "server-only";

import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";

/** Resolve only the identity proved by Discord OAuth; never match by name or email. */
export async function resolveDiscordAccountUid(
  db: Firestore,
  discordUserId: string,
  expectedUid = "",
): Promise<string> {
  if (!/^\d{5,30}$/.test(discordUserId)) throw new Error("Discord did not return a valid account identity.");
  const identityRef = db.collection("discordAccountIdentities").doc(discordUserId);
  const legacyLinks = db.collection("discordLinks").where("discordUserId", "==", discordUserId);
  // Stable across Firestore transaction retries; never use a guessed Firebase UID.
  const newUid = `discord_${randomUUID()}`;
  return db.runTransaction(async (tx) => {
    const [identity, links] = await Promise.all([tx.get(identityRef), tx.get(legacyLinks)]);
    const mappedUid = String(identity.data()?.uid ?? "").trim();
    if (identity.exists && !mappedUid) throw new Error("This Discord account needs account support before continuing.");
    const sourceUids = [...new Set([
      mappedUid,
      ...links.docs.map((link) => String(link.data().uid ?? "").trim()),
    ].filter(Boolean))];
    const canonicalUids = [...new Set(await Promise.all(sourceUids.map((uid) => canonicalUidInTransaction(db, tx, uid))))];
    if (canonicalUids.length > 1) {
      throw new Error("This Discord user is linked to more than one older RiftLite account. Contact RiftLite support before continuing.");
    }
    const uid = canonicalUids[0] || newUid;
    if (expectedUid && uid !== expectedUid) {
      throw new Error("This Discord user is not linked to the RiftLite account stored on this device. Use the original sign-in method, or Switch account in RiftLite first.");
    }
    if (!identity.exists) {
      // A single server-owned key serializes simultaneous first sign-ins. This
      // is an authentication binding, never a guild membership or consent.
      tx.create(identityRef, { uid, discordUserId, createdAt: Date.now() });
    }
    return uid;
  });
}

async function canonicalUidInTransaction(db: Firestore, tx: Transaction, sourceUid: string): Promise<string> {
  let uid = sourceUid;
  const seen = new Set<string>();
  for (let depth = 0; depth < 10; depth += 1) {
    if (seen.has(uid)) throw new Error("This Discord account has conflicting identity records. Contact RiftLite support.");
    seen.add(uid);
    const [user, alias] = await Promise.all([
      tx.get(db.collection("users").doc(uid)),
      tx.get(db.collection("identityAliases").doc(uid)),
    ]);
    const userUid = String(user.data()?.canonicalUid ?? "").trim();
    const aliasUid = String(alias.data()?.canonicalUid ?? "").trim();
    if (userUid && aliasUid && userUid !== aliasUid) {
      throw new Error("This Discord account has conflicting identity records. Contact RiftLite support.");
    }
    const canonical = aliasUid || userUid || uid;
    if (canonical === uid) return uid;
    uid = canonical;
  }
  throw new Error("This Discord account needs account support before continuing.");
}
