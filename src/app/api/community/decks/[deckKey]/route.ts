import { getDeckDetail } from "@/lib/community/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ deckKey: string }> },
) {
  const { deckKey } = await context.params;
  const detail = await getDeckDetail(decodeURIComponent(deckKey));
  if (!detail.deck) {
    return Response.json({ message: "Deck not found" }, { status: 404 });
  }
  return Response.json(detail);
}
