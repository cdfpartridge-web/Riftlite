import { type NextRequest } from "next/server";

import { normalizeMatch } from "@/lib/community/data";
import { requireLinkedProfile, resolveTeamRef, socialJson } from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeLimit(value: string | null): number {
  const n = Number(value ?? 1000);
  return Math.min(Math.max(Number.isFinite(n) ? Math.floor(n) : 1000, 1), 2000);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);

  const team = snap.data() ?? {};
  const memberSnap = await snap.ref.collection("members").doc(auth.decoded.uid).get();
  if (String(team.visibility ?? "public") === "private" && !memberSnap.exists) {
    return socialJson({ error: "You do not have access to this private team." }, 403);
  }

  const limit = safeLimit(req.nextUrl.searchParams.get("limit"));
  const rows = await snap.ref.collection("matches").orderBy("created_at", "desc").limit(limit).get();
  const matches = rows.docs
    .map((doc) => normalizeMatch(doc.id, {
      id: doc.id,
      ...doc.data(),
      scope: "team",
      team_id: snap.id,
      team_slug: team.slug,
      team_name: team.name
    }))
    .filter((match) => !match.superseded);
  return socialJson({ ok: true, matches, count: matches.length, teamId: snap.id });
}
