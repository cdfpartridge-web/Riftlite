import { type NextRequest, NextResponse } from "next/server";

import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.COMMUNITY_AGGREGATE_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-community-aggregate-secret") === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getFirestoreAdmin();
  if (!db) {
    return NextResponse.json({ error: "Firebase admin is not configured" }, { status: 503 });
  }

  const snap = await db
    .collection("users")
    .where("marketingConsent", "==", true)
    .limit(5000)
    .get();

  const subscribers = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        email: String(data.email ?? "").trim(),
        handle: String(data.handle ?? "").trim(),
        displayName: String(data.displayName ?? "").trim(),
        consentAt: Number(data.marketingConsentAt ?? 0),
        consentUpdatedAt: Number(data.marketingConsentUpdatedAt ?? 0),
        consentVersion: String(data.marketingConsentVersion ?? ""),
        consentSource: String(data.marketingConsentSource ?? ""),
      };
    })
    .filter((row) => row.email);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: subscribers.length,
    subscribers,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
