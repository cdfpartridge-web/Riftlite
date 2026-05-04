import { type NextRequest } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) return socialJson({ error: "Firebase admin is not configured" }, 503);
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  if (!q) return socialJson({ profiles: [] });
  const snap = await db
    .collection("publicProfiles")
    .where("searchable", "==", true)
    .where("searchPrefixes", "array-contains", q)
    .limit(20)
    .get();
  return socialJson({
    profiles: snap.docs.map((doc) => {
      const data = doc.data();
      return {
        uid: String(data.uid ?? ""),
        handle: String(data.handle ?? doc.id),
        displayName: String(data.displayName ?? data.handle ?? doc.id),
      };
    }),
  });
}
