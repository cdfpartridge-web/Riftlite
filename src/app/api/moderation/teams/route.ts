import { type NextRequest } from "next/server";

import {
  fullTeamFromDoc,
  requireSocialModerator,
  socialJson
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireSocialModerator(req);
  if ("error" in auth) return auth.error;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 100), 1), 200);
  const q = String(req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const snap = await auth.db.collection("teams")
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  const teams = snap.docs
    .map((doc) => ({ ...fullTeamFromDoc(doc.id, doc.data() ?? {}), moderationStatus: String(doc.data()?.moderationStatus ?? ""), moderationReason: String(doc.data()?.moderationReason ?? ""), moderatedAt: Number(doc.data()?.moderatedAt ?? 0), moderatedBy: String(doc.data()?.moderatedBy ?? "") }))
    .filter((team) => !q || team.name.toLowerCase().includes(q) || team.slug.toLowerCase().includes(q) || team.ownerHandle.toLowerCase().includes(q));
  return socialJson({ ok: true, isModerator: true, teams });
}
