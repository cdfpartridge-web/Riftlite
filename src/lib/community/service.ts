import {
  buildDeckGroups,
  buildLegendMeta,
  buildMatrix,
  buildOverview,
  deckGroupKey,
  getDeckGroupByKey,
} from "@/lib/community/aggregate";
import { applyCommunityFilters, paginate } from "@/lib/community/filters";
import {
  getCommunityAggregateCounts,
  getCommunityMatchWindow,
} from "@/lib/community/data";
import {
  buildDeckComparison,
  buildLegendProfile,
  buildPlayerProfile,
  listPlayerNames,
} from "@/lib/community/profiles";
import type { CommunityFilterParams } from "@/lib/types";

export async function getFilteredCommunityMatches(filters: CommunityFilterParams) {
  const matches = await getCommunityMatchWindow();
  return applyCommunityFilters(matches, filters);
}

export async function getCommunityOverview() {
  const [matches, aggregateCounts] = await Promise.all([
    getCommunityMatchWindow(),
    getCommunityAggregateCounts(),
  ]);
  return buildOverview(matches, aggregateCounts);
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

export async function getPlayerProfile(username: string) {
  const matches = await getCommunityMatchWindow();
  return buildPlayerProfile(matches, username);
}

export async function getLegendProfile(legend: string) {
  const matches = await getCommunityMatchWindow();
  return buildLegendProfile(matches, legend);
}

export async function getDeckComparison(keyA: string, keyB: string) {
  const matches = await getCommunityMatchWindow();
  return buildDeckComparison(matches, keyA, keyB);
}

export async function listAllPlayerNames() {
  const matches = await getCommunityMatchWindow();
  return listPlayerNames(matches);
}

export async function listAllDeckGroups() {
  const matches = await getCommunityMatchWindow();
  return buildDeckGroups(matches);
}
