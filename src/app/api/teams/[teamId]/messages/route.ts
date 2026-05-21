import { type NextRequest } from "next/server";

import {
  TEAM_MESSAGE_LIMIT,
  assertTeamRole,
  cleanLongText,
  newId,
  parseBody,
  requireLinkedProfile,
  resolveTeamRef,
  socialJson,
  socialMentions,
  teamMessageFromDoc
} from "@/lib/social-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin", "member"]);
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? TEAM_MESSAGE_LIMIT), 1), 80);
  const rows = await snap.ref.collection("messages").orderBy("createdAt", "desc").limit(limit).get();
  return socialJson({ ok: true, messages: rows.docs.map((doc) => teamMessageFromDoc(doc.id, doc.data())) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await requireLinkedProfile(req);
  if ("error" in auth) return auth.error;
  const { teamId } = await params;
  const snap = await resolveTeamRef(auth.db, teamId);
  if (!snap) return socialJson({ error: "Team not found." }, 404);
  await assertTeamRole(snap.id, auth.decoded.uid, ["owner", "admin", "member"]);
  const body = await parseBody(req);
  const text = cleanLongText(body.text, 2000);
  if (!text) return socialJson({ error: "Message is required." }, 400);
  const now = Date.now();
  const id = newId();
  const message = {
    id,
    uid: auth.decoded.uid,
    handle: auth.profile.handle,
    displayName: auth.displayName,
    text,
    mentions: socialMentions(text),
    pinned: Boolean(body.pinned),
    deleted: false,
    createdAt: now,
    updatedAt: now
  };
  await snap.ref.collection("messages").doc(id).set(message);
  await snap.ref.set({ lastMessageAt: now, lastMessageText: text.slice(0, 140), updatedAt: now }, { merge: true });
  return socialJson({ ok: true, message });
}
