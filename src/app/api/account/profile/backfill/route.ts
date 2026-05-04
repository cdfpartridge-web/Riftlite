import { type NextRequest } from "next/server";

import {
  ensureUserProfile,
  rebuildUserPublicAggregate,
  requireUser,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANUAL_BACKFILL_COOLDOWN_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "", auth.decoded.email ?? "");
  if (!profile.publicProfile || !profile.handleLower) {
    return socialJson({ error: "Make your profile public and choose a handle before refreshing profile matches." }, 400);
  }

  const aggregateRef = auth.db.collection("userAggregates").doc(auth.decoded.uid);
  const aggregateSnap = await aggregateRef.get();
  const aggregate = aggregateSnap.data() ?? {};
  const lastManualBackfillAt = Number(aggregate.manualBackfillAt ?? 0);
  if (Date.now() - lastManualBackfillAt < MANUAL_BACKFILL_COOLDOWN_MS) {
    return socialJson({
      ok: true,
      skipped: true,
      message: "Profile matches were refreshed recently. Try again in a few minutes.",
      aggregate: {
        totalMatches: Number(aggregate.totalMatches ?? 0),
        wins: Number(aggregate.wins ?? 0),
        losses: Number(aggregate.losses ?? 0),
        draws: Number(aggregate.draws ?? 0),
        winRate: Number(aggregate.winRate ?? 0),
      },
    });
  }

  try {
    const rebuilt = await rebuildUserPublicAggregate(profile);
    await aggregateRef.set({ manualBackfillAt: Date.now() }, { merge: true });
    return socialJson({
      ok: true,
      skipped: false,
      message: `Profile refreshed with ${rebuilt?.totalMatches ?? 0} public matches.`,
      aggregate: rebuilt,
    });
  } catch (error) {
    await aggregateRef.set({
      manualBackfillAt: Date.now(),
      backfillAttemptAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true }).catch(() => undefined);
    return socialJson({
      error: error instanceof Error ? error.message : "Profile match refresh failed.",
    }, 500);
  }
}
