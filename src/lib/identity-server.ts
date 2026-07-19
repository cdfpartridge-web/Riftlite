import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { canonicalUidFromIdentityRecords } from "@/lib/account-connection";
import { getFirestoreAdmin } from "@/lib/firebase/admin";

export async function canonicalIdentityUid(uid: unknown, providedDb?: Firestore): Promise<string> {
  const source = String(uid ?? "").trim();
  if (!source) return "";
  const db = providedDb ?? getFirestoreAdmin();
  if (!db) return source;

  let current = source;
  const seen = new Set<string>();
  for (let depth = 0; depth < 3 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    const [userSnap, aliasSnap] = await Promise.all([
      db.collection("users").doc(current).get().catch(() => null),
      db.collection("identityAliases").doc(current).get().catch(() => null),
    ]);
    const canonical = canonicalUidFromIdentityRecords(
      current,
      userSnap?.data() ?? null,
      aliasSnap?.data() ?? null,
    );
    if (!canonical || canonical === current) return current;
    current = canonical;
  }
  return current || source;
}
