import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { assertHubRole, cleanDisplayName, ensureUserProfile, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin", "member"]);
    const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 25)));
    const snap = await auth.db
      .collection("hubs")
      .doc(hubId)
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return socialJson({
      messages: snap.docs.map((doc) => {
        const data = doc.data();
        const handle = String(data.handle ?? "").trim();
        return {
          id: doc.id,
          ...data,
          displayName: cleanDisplayName(data.displayName, handle || "Member"),
        };
      }),
    });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not load messages" }, 403);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ hubId: string }> }) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const { hubId } = await params;
  const body = await readBody(req);
  const text = String(body.text ?? "").trim().slice(0, 2000);
  if (!text) return socialJson({ error: "Message is required" }, 400);
  try {
    await assertHubRole(hubId, auth.decoded.uid, ["owner", "admin", "member"]);
    const profile = await ensureUserProfile(auth.decoded.uid, auth.decoded.name ?? auth.decoded.email ?? "");
    const id = randomUUID();
    const message = {
      id,
      uid: auth.decoded.uid,
      handle: profile.handle,
      displayName: cleanDisplayName(profile.displayName, profile.handle || "Member"),
      text,
      mentions: Array.from(new Set(text.match(/@[a-z0-9_-]{3,24}/gi)?.map((item) => item.slice(1).toLowerCase()) ?? [])).slice(0, 12),
      pinned: false,
      deleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await auth.db.collection("hubs").doc(hubId).collection("messages").doc(id).set(message);
    await auth.db.collection("hubs").doc(hubId).set({ lastMessageAt: Date.now(), lastMessageText: text.slice(0, 120) }, { merge: true });
    return socialJson({ ok: true, message });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Could not post message" }, 403);
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
