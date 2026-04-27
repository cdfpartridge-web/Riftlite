import { getCommunityMatchWindow } from "@/lib/community/data";
import { communityJson } from "@/lib/community/response";

// Desktop-facing community matches feed.
//
// The desktop client (RiftLite-Desktop) calls this with `?limit=all`
// to populate its in-app Community view. It expects the FULL match
// window — no pagination, no slicing — so it can dedupe, sort, and
// render locally. The hard cap is COMMUNITY_WINDOW_SIZE in
// `src/lib/constants.ts`, enforced by the underlying aggregate doc.
//
// Shape: `{ matches, count, updatedAt }`. The desktop's `fromWebMatch`
// reader accepts both snake_case Firestore fields and the camelCase
// CommunityMatch fields we emit here, so the normalised website blob
// round-trips cleanly into the desktop's CommunityMatch type without
// any extra adapter on the desktop side.
//
// Costs: served from the cached match window (1 Firestore read per
// 10-minute cache miss, shared with the rest of the website). The
// desktop's own forceRefresh flag is honoured by hitting this endpoint
// fresh — it doesn't bypass the server cache, but at desktop-poll
// volume that's fine.
export async function GET() {
  const matches = await getCommunityMatchWindow();
  return communityJson({
    matches,
    count: matches.length,
    updatedAt: Date.now(),
  });
}
