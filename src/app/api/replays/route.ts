import { NextResponse } from "next/server";

import { verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { listRiftLiteReplays } from "@/lib/riftreplay/replay-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 96);
  const mine = url.searchParams.get("mine") === "1";
  let ownerUid = "";

  if (mine) {
    const token = bearerToken(request.headers.get("authorization"));
    const decoded = token ? await verifyFirebaseIdToken(token) : null;
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Sign in to view your private replay library." }, { status: 401 });
    }
    ownerUid = decoded.uid;
  }

  const items = await listRiftLiteReplays({ limit, ownerUid });
  return NextResponse.json(
    { items, count: items.length },
    {
      headers: {
        "Cache-Control": mine ? "no-store" : "public, s-maxage=120, stale-while-revalidate=600",
      },
    },
  );
}

function bearerToken(value: string | null) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1]?.trim() ?? "";
}
