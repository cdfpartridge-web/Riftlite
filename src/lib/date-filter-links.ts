const DATE_QUERY_KEYS = ["range", "from", "to", "timeZone", "season", "format"] as const;

/** Keep report scope when following a data drilldown, without copying paging or searches. */
export function withDateFilterQuery(href: string, source: URLSearchParams): string {
  if (!/^\/(community|user|teams)(\/|\?|$)/.test(href)) return href;
  const target = new URL(href, "https://local.invalid");
  for (const key of DATE_QUERY_KEYS) {
    const value = source.get(key);
    if (value !== null && (value || key === "season") && !target.searchParams.has(key)) target.searchParams.set(key, value);
  }
  return `${target.pathname}${target.search}${target.hash}`;
}
