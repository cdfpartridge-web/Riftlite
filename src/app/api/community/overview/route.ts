import { communityJson } from "@/lib/community/response";
import { getCommunityOverview } from "@/lib/community/service";

export async function GET() {
  return communityJson(await getCommunityOverview());
}
