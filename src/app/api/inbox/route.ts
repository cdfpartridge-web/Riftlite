import { type NextRequest } from "next/server";

import { requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const now = Date.now();
  const snap = await auth.db
    .collection("users")
    .doc(auth.decoded.uid)
    .collection("inbox")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  const items = snap.docs.map((doc) => {
    const data = doc.data();
    const status = String(data.status ?? "open");
    return {
      id: doc.id,
      ...data,
      status: status === "open" && Number(data.expiresAt ?? 0) < now ? "expired" : status,
    };
  });
  return socialJson({ ok: true, items });
}
