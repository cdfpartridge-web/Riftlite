import { parseFilters } from "@/lib/community/filters";
import { communityJson } from "@/lib/community/response";
import { getDeckDetail } from "@/lib/community/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ deckKey: string }> },
) {
  const { deckKey } = await context.params;
  const detail = await getDeckDetail(decodeURIComponent(deckKey), parseFilters(new URL(request.url).searchParams));
  if (!detail.deck) {
    return Response.json({ message: "Deck not found" }, { status: 404 });
  }
  return communityJson(detail);
}
