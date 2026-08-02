import { type NextRequest } from "next/server";

import { searchDiscoverablePublicProfiles, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  const profiles = await searchDiscoverablePublicProfiles(q, q ? 20 : 24);
  return socialJson({ profiles });
}
