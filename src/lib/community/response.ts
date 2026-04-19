// Matches COMMUNITY_CACHE_TTL_SECONDS in data.ts. Keep these two in sync —
// the edge cache TTL should not outlive the underlying server cache.
const COMMUNITY_CACHE_HEADER =
  "public, s-maxage=600, stale-while-revalidate=1200";

export function communityJson(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": COMMUNITY_CACHE_HEADER,
      ...(init?.headers ?? {}),
    },
  });
}
