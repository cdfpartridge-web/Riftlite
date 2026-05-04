import { type NextRequest } from "next/server";

import { getPublicProfileByHandle, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await getPublicProfileByHandle(decodeURIComponent(handle));
  if (!profile) return socialJson({ error: "Profile not found" }, 404);
  return socialJson(profile);
}
