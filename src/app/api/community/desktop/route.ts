import { getCommunityMatchWindow } from "@/lib/community/data";
import { communityJson } from "@/lib/community/response";
import type { CommunityMatch, MatchGame } from "@/lib/types";

// Desktop-facing community matches feed.
//
// The desktop client (RiftLite-Desktop) calls this with `?limit=all`
// to populate its in-app Community view. It expects the FULL match
// window — no pagination, no slicing — so it can dedupe, sort, and
// render locally. The hard cap is COMMUNITY_WINDOW_SIZE in
// `src/lib/constants.ts`, enforced by the underlying aggregate doc.
//
// Top-level shape: `{ matches, count, updatedAt }`. The desktop's
// `fromWebMatch` reader accepts both snake_case Firestore fields and
// the camelCase CommunityMatch fields we emit here, so the normalised
// website blob round-trips cleanly into the desktop's CommunityMatch
// type without any extra adapter on the desktop side.
//
// Per-game shape: the desktop's drilldown view expects games with
// gameNumber + myBattlefield/oppBattlefield (not the internal myBf/
// oppBf used by the website renderer). We expand each game here so
// the desktop gets the long-form fields, while keeping myBf/oppBf as
// aliases so anything still reading the old shape keeps working.
//
// Costs: served from the cached match window (1 Firestore read per
// 10-minute cache miss, shared with the rest of the website). The
// desktop's own forceRefresh flag is honoured by hitting this endpoint
// fresh — it doesn't bypass the server cache, but at desktop-poll
// volume that's fine.

type DesktopGame = MatchGame & {
  gameNumber: number;
  myBattlefield: string;
  oppBattlefield: string;
};

type DesktopMatch = Omit<CommunityMatch, "games"> & {
  games: DesktopGame[];
};

function expandGames(games: MatchGame[]): DesktopGame[] {
  return games.map((game, index) => ({
    ...game,
    gameNumber: index + 1,
    myBattlefield: game.myBf,
    oppBattlefield: game.oppBf,
  }));
}

function toDesktopMatch(match: CommunityMatch): DesktopMatch {
  return {
    ...match,
    games: expandGames(match.games ?? []),
  };
}

export async function GET() {
  const matches = await getCommunityMatchWindow();
  const desktopMatches = matches.map(toDesktopMatch);
  return communityJson({
    matches: desktopMatches,
    count: desktopMatches.length,
    updatedAt: Date.now(),
  });
}
