import { type NextRequest } from "next/server";

import {
  cleanList,
  cleanLongText,
  cleanSlug,
  cleanTeamVisibility,
  cleanText,
  cleanUrl,
  fullTeamFromDoc,
  newId,
  parseBody,
  publicTeamFromDoc,
  requireLinkedProfile,
  socialJson,
  teamPublicDoc,
  validSlug
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 48), 1), 80);
  const mine = req.nextUrl.searchParams.get("mine") === "1";
  const q = cleanText(req.nextUrl.searchParams.get("q"), 30).toLowerCase();

  let docs;
  if (mine) {
    const memberSnap = await auth.db.collectionGroup("members")
      .where("uid", "==", auth.decoded.uid)
      .limit(100)
      .get();
    const teamRefs = memberSnap.docs.flatMap((doc) => {
      const ref = doc.ref.parent.parent;
      return ref ? [ref] : [];
    });
    const teamSnaps = teamRefs.length ? await auth.db.getAll(...teamRefs) : [];
    const teams = teamSnaps
      .filter((doc) => doc.exists)
      .map((doc) => fullTeamFromDoc(doc.id, doc.data() ?? {}))
      .filter((team) => !q || team.searchPrefixes.includes(q) || team.name.toLowerCase().includes(q) || team.slug.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
    return socialJson({ ok: true, teams });
  }

  if (q) {
    docs = await auth.db.collection("publicTeams")
      .where("searchPrefixes", "array-contains", q)
      .limit(limit)
      .get();
  } else {
    docs = await auth.db.collection("publicTeams")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
  }
  return socialJson({ ok: true, teams: docs.docs.map((doc) => publicTeamFromDoc(doc.id, doc.data())) });
}

export async function POST(req: NextRequest) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const body = await parseBody(req);
  const name = cleanText(body.name, 60);
  const slug = cleanSlug(body.slug || name);
  if (!name) return socialJson({ error: "Team name is required." }, 400);
  if (!validSlug(slug)) return socialJson({ error: "Team slug must be 3-48 lowercase letters, numbers, or hyphens." }, 400);

  const now = Date.now();
  const id = newId();
  const visibility = cleanTeamVisibility(body.visibility);
  const team = {
    id,
    slug,
    name,
    description: cleanLongText(body.description, 1500),
    region: cleanText(body.region, 80),
    locationMode: cleanText(body.locationMode, 40),
    visibility,
    purposes: cleanList(body.purposes, 10, 32),
    recruitmentStatus: cleanText(body.recruitmentStatus, 24) || "open",
    discord: cleanUrl(body.discord),
    website: cleanUrl(body.website),
    socials: {
      x: cleanUrl((body.socials as Record<string, unknown> | undefined)?.x ?? body.x),
      youtube: cleanUrl((body.socials as Record<string, unknown> | undefined)?.youtube ?? body.youtube),
      twitch: cleanUrl((body.socials as Record<string, unknown> | undefined)?.twitch ?? body.twitch),
      instagram: cleanUrl((body.socials as Record<string, unknown> | undefined)?.instagram ?? body.instagram),
      metafy: cleanUrl((body.socials as Record<string, unknown> | undefined)?.metafy ?? body.metafy)
    },
    logoUrl: cleanUrl(body.logoUrl),
    bannerUrl: cleanUrl(body.bannerUrl),
    ownerUid: auth.decoded.uid,
    ownerHandle: auth.profile.handle,
    ownerDisplayName: auth.displayName,
    hidden: visibility !== "public",
    memberCount: 1,
    applicationCount: 0,
    createdAt: now,
    updatedAt: now
  };

  const slugRef = auth.db.collection("teamSlugs").doc(slug);
  const teamRef = auth.db.collection("teams").doc(id);
  const publicRef = auth.db.collection("publicTeams").doc(id);
  await auth.db.runTransaction(async (tx) => {
    const slugSnap = await tx.get(slugRef);
    if (slugSnap.exists) throw new Error("That team URL is already taken.");
    tx.set(slugRef, { teamId: id, slug, updatedAt: now });
    tx.set(teamRef, { ...team, searchPrefixes: teamPublicDoc(team).searchPrefixes });
    if (visibility === "public") tx.set(publicRef, teamPublicDoc(team));
    tx.set(teamRef.collection("members").doc(auth.decoded.uid), {
      id: auth.decoded.uid,
      uid: auth.decoded.uid,
      handle: auth.profile.handle,
      displayName: auth.displayName,
      role: "owner",
      joinedAt: now,
      updatedAt: now
    });
  });

  return socialJson({ ok: true, team: fullTeamFromDoc(id, team) });
}
