import { type NextRequest } from "next/server";

import {
  cleanLongText,
  cleanTeamVisibility,
  fullTeamFromDoc,
  parseBody,
  requireSocialModerator,
  resolveTeamRef,
  socialJson,
  teamPublicDoc
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ModerationAction = "hide" | "restore" | "clear-logo" | "clear-banner" | "clear-images";

function readAction(value: unknown): ModerationAction | "" {
  const action = String(value ?? "");
  return action === "hide" || action === "restore" || action === "clear-logo" || action === "clear-banner" || action === "clear-images" ? action : "";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireSocialModerator(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);

  const body = await parseBody(req);
  const action = readAction(body.action);
  if (!action) return socialJson({ error: "Unknown moderation action." }, 400);

  const now = Date.now();
  const current = snap.data() ?? {};
  const reason = cleanLongText(body.reason, 1000);
  const patch: Record<string, unknown> = {
    moderatedAt: now,
    moderatedBy: auth.profile.handle || auth.decoded.uid,
    moderationReason: reason,
    updatedAt: now
  };

  if (action === "hide") {
    patch.hidden = true;
    patch.moderationStatus = "hidden";
  } else if (action === "restore") {
    patch.hidden = cleanTeamVisibility(current.visibility) !== "public";
    patch.moderationStatus = "approved";
  } else if (action === "clear-logo") {
    patch.logoUrl = "";
    patch.moderationStatus = "image-cleared";
  } else if (action === "clear-banner") {
    patch.bannerUrl = "";
    patch.moderationStatus = "image-cleared";
  } else if (action === "clear-images") {
    patch.logoUrl = "";
    patch.bannerUrl = "";
    patch.moderationStatus = "image-cleared";
  }

  const next: Record<string, unknown> = { ...current, ...patch, id: snap.id };
  const batch = auth.db.batch();
  batch.set(snap.ref, patch, { merge: true });
  const publicRef = auth.db.collection("publicTeams").doc(snap.id);
  if (cleanTeamVisibility(next.visibility) === "public" && !next.hidden) {
    batch.set(publicRef, teamPublicDoc(next), { merge: true });
  } else {
    batch.delete(publicRef);
  }
  await batch.commit();

  return socialJson({
    ok: true,
    team: {
      ...fullTeamFromDoc(snap.id, next),
      moderationStatus: String(next.moderationStatus ?? ""),
      moderationReason: String(next.moderationReason ?? ""),
      moderatedAt: Number(next.moderatedAt ?? 0),
      moderatedBy: String(next.moderatedBy ?? "")
    }
  });
}
