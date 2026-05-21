import { type NextRequest } from "next/server";

import {
  assertTeamRole,
  cleanList,
  cleanLongText,
  cleanSlug,
  cleanTeamVisibility,
  cleanText,
  cleanUrl,
  fullTeamFromDoc,
  parseBody,
  requireLinkedProfile,
  resolveTeamRef,
  socialJson,
  teamPublicDoc
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  const team = fullTeamFromDoc(snap.id, snap.data() ?? {});
  const memberSnap = await snap.ref.collection("members").orderBy("joinedAt", "asc").limit(100).get();
  const myMember = memberSnap.docs.find((doc) => doc.id === auth.decoded.uid);
  if (team.visibility === "private" && !myMember) return socialJson({ error: "You do not have access to this private team." }, 403);
  return socialJson({
    ok: true,
    team,
    members: memberSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    myRole: myMember ? String(myMember.data().role ?? "member") : ""
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin"]);
  const body = await parseBody(req);
  const current = snap.data() ?? {};
  const now = Date.now();
  const visibility = cleanTeamVisibility(body.visibility ?? current.visibility);
  const name = cleanText(body.name ?? current.name, 60);
  const slug = cleanSlug(body.slug ?? current.slug);
  if (!name) return socialJson({ error: "Team name is required." }, 400);
  if (!slug) return socialJson({ error: "Team slug is required." }, 400);

  const patch = {
    ...current,
    id: snap.id,
    slug,
    name,
    description: cleanLongText(body.description ?? current.description, 1500),
    region: cleanText(body.region ?? current.region, 80),
    locationMode: cleanText(body.locationMode ?? current.locationMode, 40),
    visibility,
    purposes: cleanList(body.purposes ?? current.purposes, 10, 32),
    recruitmentStatus: cleanText(body.recruitmentStatus ?? current.recruitmentStatus, 24) || "open",
    discord: cleanUrl(body.discord ?? current.discord),
    website: cleanUrl(body.website ?? current.website),
    socials: {
      ...((current.socials && typeof current.socials === "object") ? current.socials as Record<string, unknown> : {}),
      ...((body.socials && typeof body.socials === "object") ? body.socials as Record<string, unknown> : {})
    },
    logoUrl: cleanUrl(body.logoUrl ?? current.logoUrl),
    bannerUrl: cleanUrl(body.bannerUrl ?? current.bannerUrl),
    hidden: visibility !== "public",
    updatedAt: now
  };
  patch.socials = {
    x: cleanUrl(patch.socials.x),
    youtube: cleanUrl(patch.socials.youtube),
    twitch: cleanUrl(patch.socials.twitch),
    instagram: cleanUrl(patch.socials.instagram),
    metafy: cleanUrl(patch.socials.metafy)
  };
  const publicDoc = teamPublicDoc(patch);
  await auth.db.runTransaction(async (tx) => {
    if (slug !== current.slug) {
      const slugRef = auth.db.collection("teamSlugs").doc(slug);
      const slugSnap = await tx.get(slugRef);
      if (slugSnap.exists && slugSnap.data()?.teamId !== snap.id) {
        throw new Error("That team URL is already taken.");
      }
      tx.set(slugRef, { teamId: snap.id, slug, updatedAt: now }, { merge: true });
      if (current.slug) tx.delete(auth.db.collection("teamSlugs").doc(String(current.slug)));
    }
    tx.set(snap.ref, { ...patch, searchPrefixes: publicDoc.searchPrefixes }, { merge: true });
    const publicRef = auth.db.collection("publicTeams").doc(snap.id);
    if (visibility === "public") {
      tx.set(publicRef, publicDoc, { merge: true });
    } else {
      tx.delete(publicRef);
    }
  });
  return socialJson({ ok: true, team: fullTeamFromDoc(snap.id, patch) });
}
