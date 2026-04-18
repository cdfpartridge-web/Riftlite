const COMMUNITY_CACHE_HEADER =
  "public, s-maxage=300, stale-while-revalidate=600";

export function communityJson(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": COMMUNITY_CACHE_HEADER,
      ...(init?.headers ?? {}),
    },
  });
}
