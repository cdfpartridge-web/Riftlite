import { parseFilters } from "@/lib/community/filters";
import { communityJson } from "@/lib/community/response";
import { getPaginatedDecks } from "@/lib/community/service";

export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams);
  return communityJson(await getPaginatedDecks(filters));
}
