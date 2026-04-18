import { getCommunityOverview } from "@/lib/community/service";

export async function GET() {
  return Response.json(await getCommunityOverview());
}
