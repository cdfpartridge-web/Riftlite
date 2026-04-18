import {
  buildDeckGroups,
  buildLeaderboard,
  buildLegendMeta,
  buildMatrix,
  buildOverview,
  deckGroupKey,
  getDeckGroupByKey,
} from "@/lib/community/aggregate";
import { applyCommunityFilters, paginate } from "@/lib/community/filters";
import { getCommunityMatchWindow } from "@/lib/community/data";
import type { CommunityFilterParams } from "@/lib/types";

export async function getFilteredCommunityMatches(filters: CommunityFilterParams) {
  const matches = await getCommunityMatchWindow();
  return applyCommunityFilters(matches, filters);
}

export async function getCommunityOverview() {
  const matches = await getCommunityMatchWindow();
  return buildOverview(matches);
}

export async function getLeaderboard(filters: CommunityFilterParams) {
  return buildLeaderboard(await getFilteredCommunityMatches(filters));
}

export async function getLegendMeta(filters: CommunityFilterParams) {
  return buildLegendMeta(await getFilteredCommunityMatches(filters));
}

export async function getMatrix(filters: CommunityFilterParams) {
  return buildMatrix(await getFilteredCommunityMatches(filters));
}

export async function getPaginatedMatches(filters: CommunityFilterParams) {
  const matches = await getFilteredCommunityMatches(filters);
  return paginate(matches, filters.page, filters.pageSize);
}

export async function getPaginatedDecks(filters: CommunityFilterParams) {
  const matches = await getFilteredCommunityMatches(filters);
  const decks = buildDeckGroups(matches);
  return paginate(decks, filters.page, filters.pageSize);
}

export async function getDeckDetail(deckKey: string) {
  const matches = await getCommunityMatchWindow();
  const deck = getDeckGroupByKey(matches, deckKey);
  const deckMatches = matches.filter((match) => deckGroupKey(match) === deckKey);

  return {
    deck,
    matches: deckMatches,
  };
}
