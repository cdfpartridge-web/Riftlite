import { parseFilters } from "@/lib/community/filters";
import { getPaginatedDecks } from "@/lib/community/service";

export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams);
  return Response.json(await getPaginatedDecks(filters));
}
