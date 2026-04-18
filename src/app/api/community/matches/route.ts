import { parseFilters } from "@/lib/community/filters";
import { getPaginatedMatches } from "@/lib/community/service";

export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams);
  return Response.json(await getPaginatedMatches(filters));
}
