import { type NextRequest } from "next/server";

import { createFirebaseCustomToken, getFirestoreAdmin } from "@/lib/firebase/admin";
import { socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) return socialJson({ error: "Firebase admin is not configured" }, 503);

  const body = await readBody(req);
  const sessionId = String(body.sessionId ?? "").trim();
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!sessionId || !code) return socialJson({ error: "Missing session or code" }, 400);

  const ref = db.collection("desktopLinkSessions").doc(sessionId);
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists || !data) return socialJson({ error: "Link session not found" }, 404);
  if (String(data.status ?? "") !== "pending") return socialJson({ error: "Link session has already been used" }, 409);
  if (String(data.code ?? "").toUpperCase() !== code) return socialJson({ error: "Link code did not match" }, 403);
  if (Number(data.expiresAt ?? 0) < Date.now()) return socialJson({ error: "Link session expired" }, 410);

  const desktopUid = String(data.desktopUid ?? "");
  if (!desktopUid) return socialJson({ error: "Link session is missing a desktop user" }, 400);

  const customToken = await createFirebaseCustomToken(desktopUid);
  if (!customToken) return socialJson({ error: "Could not prepare desktop account link" }, 500);

  await ref.set({ bootstrapIssuedAt: Date.now() }, { merge: true });
  return socialJson({ customToken });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
