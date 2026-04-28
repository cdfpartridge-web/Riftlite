import type {
  WeeklyDeckStats,
  WeeklyLegendStats,
  WeeklyPlayerStats,
  WeeklySnapshot,
} from "@/lib/community/weekly-snapshot";

// Minimum sample size before we quote a win rate. Below this, variance
// swamps signal — a 2-1 legend isn't "66% WR," it's "played 3 games."
// Keep this low enough that early-stage reports still have something
// to say, high enough that we don't mislead readers with noise.
const MIN_WINRATE_SAMPLE = 5;

// Minimum matches in a week before the report bothers publishing any
// detailed content. Below this we just note the low sample and invite
// people to play more — otherwise the "report" is two bullet points
// of nonsense.
const MIN_REPORT_SAMPLE = 10;

// Portable text block types we use. We stay inside the vanilla block
// types the default @portabletext/react renderer understands (h2, h3,
// normal, blockquote; and mark types 'strong' and 'em'). This avoids
// needing any custom block/renderer wiring on the news page.
type Span = { _type: "span"; text: string; marks: string[] };
type Block = {
  _type: "block";
  style: "normal" | "h2" | "h3" | "blockquote";
  markDefs: unknown[];
  listItem?: "bullet";
  level?: number;
  children: Span[];
};

type InlineText = string | { text: string; bold?: boolean; italic?: boolean };

function span(...parts: InlineText[]): Span[] {
  return parts.map((p) => {
    if (typeof p === "string") return { _type: "span" as const, text: p, marks: [] };
    const marks: string[] = [];
    if (p.bold) marks.push("strong");
    if (p.italic) marks.push("em");
    return { _type: "span" as const, text: p.text, marks };
  });
}

function h2(...parts: InlineText[]): Block {
  return { _type: "block", style: "h2", markDefs: [], children: span(...parts) };
}
function h3(...parts: InlineText[]): Block {
  return { _type: "block", style: "h3", markDefs: [], children: span(...parts) };
}
function p(...parts: InlineText[]): Block {
  return { _type: "block", style: "normal", markDefs: [], children: span(...parts) };
}
function bullet(...parts: InlineText[]): Block {
  return {
    _type: "block",
    style: "normal",
    markDefs: [],
    listItem: "bullet",
    level: 1,
    children: span(...parts),
  };
}
function quote(...parts: InlineText[]): Block {
  return { _type: "block", style: "blockquote", markDefs: [], children: span(...parts) };
}

function fmtPct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtDelta(delta: number, suffix = "pp"): string {
  if (!Number.isFinite(delta) || delta === 0) return "no change";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)}${suffix}`;
}

function fmtWeekRange(startMs: number, endMs: number): string {
  // endMs is the exclusive Monday-after-the-week timestamp; subtract 1
  // so we render the inclusive Sunday at the end of the week.
  const start = new Date(startMs);
  const end = new Date(endMs - 1);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const startMonth = start.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const endYear = end.getUTCFullYear();
  if (sameMonth) {
    // "Apr 20 – 26, 2026"
    return `${startMonth} ${startDay} – ${endDay}, ${endYear}`;
  }
  const endMonth = end.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  // "Apr 27 – May 3, 2026"
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${endYear}`;
}

function findBy<T extends { legend?: string; deckKey?: string; uid?: string }>(
  items: T[],
  matcher: (item: T) => boolean,
): T | undefined {
  return items.find(matcher);
}

/**
 * Compute the biggest win-rate mover among legends, restricted to
 * legends that have enough sample in BOTH weeks to trust the number.
 * Returns null if no legend crosses the threshold in both windows.
 */
function biggestLegendMover(
  thisWeek: WeeklyLegendStats[],
  lastWeek: WeeklyLegendStats[],
  direction: "up" | "down",
): { legend: string; delta: number; current: number; previous: number } | null {
  let best: { legend: string; delta: number; current: number; previous: number } | null = null;
  for (const cur of thisWeek) {
    if (cur.plays < MIN_WINRATE_SAMPLE) continue;
    const prev = findBy(lastWeek, (l) => l.legend === cur.legend);
    if (!prev || prev.plays < MIN_WINRATE_SAMPLE) continue;
    const delta = cur.winRate - prev.winRate;
    if (direction === "up" && delta <= 0) continue;
    if (direction === "down" && delta >= 0) continue;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { legend: cur.legend, delta, current: cur.winRate, previous: prev.winRate };
    }
  }
  return best;
}

/**
 * New-this-week: deck keys that appear in thisWeek but not lastWeek.
 * Filters to decks with at least MIN_WINRATE_SAMPLE plays so we don't
 * highlight a one-game curiosity.
 */
function breakoutDecks(
  thisWeek: WeeklyDeckStats[],
  lastWeek: WeeklyDeckStats[],
): WeeklyDeckStats[] {
  const lastKeys = new Set(lastWeek.map((d) => d.deckKey));
  return thisWeek
    .filter((d) => !lastKeys.has(d.deckKey) && d.plays >= MIN_WINRATE_SAMPLE)
    .sort((a, b) => b.winRate - a.winRate);
}

function topPlayerByPlays(players: WeeklyPlayerStats[]): WeeklyPlayerStats | null {
  return players[0] ?? null;
}

function topPlayerByWinRate(players: WeeklyPlayerStats[]): WeeklyPlayerStats | null {
  const eligible = players.filter((p) => p.plays >= MIN_WINRATE_SAMPLE);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, cur) => (cur.winRate > best.winRate ? cur : best));
}

export type MetaReport = {
  title: string;
  slug: string;
  excerpt: string;
  body: Block[];
  // Human-readable tags that get tacked onto the Sanity doc. Useful for
  // filtering "weekly reports" on /news later.
  tags: string[];
};

/**
 * Turn a pair of snapshots (this week, last week or null) into a
 * publishable article. Pure function — no Firestore or Sanity I/O.
 * That way the cron endpoint can diff snapshots in isolation and the
 * unit tests don't need any backing services.
 */
export function buildMetaReport(
  current: WeeklySnapshot,
  previous: WeeklySnapshot | null,
): MetaReport {
  const weekId = current.week;
  const dateRange = fmtWeekRange(current.startMs, current.endMs);
  const title = `Weekly Meta Report · ${dateRange}`;
  const slug = `meta-report-${weekId.toLowerCase()}`;
  const tags = ["meta-report", "weekly", weekId];

  // Low-data week: still publish so the feed has a consistent rhythm,
  // but keep it short and honest rather than inventing narrative from
  // noise.
  if (current.matchCount < MIN_REPORT_SAMPLE) {
    const excerpt = `Only ${current.matchCount} match${
      current.matchCount === 1 ? "" : "es"
    } tracked this week — not enough data for a full meta read. Jump in and help fill the next report.`;
    const body: Block[] = [
      h2("Quiet week"),
      p(
        `We tracked ${current.matchCount} match${
          current.matchCount === 1 ? "" : "es"
        } across ${current.uniquePlayers} player${
          current.uniquePlayers === 1 ? "" : "s"
        } during ${dateRange}. That's below the threshold we need to call trends without making things up.`,
      ),
      p(
        "If you'd like next Monday's report to have more signal, the best way to help is to play a few games with the desktop app running — it syncs automatically. Share the download with your pod if you haven't already.",
      ),
    ];
    return { title, slug, excerpt, body, tags };
  }

  // Headline stat — most-played legend this week.
  const topLegend = current.legends[0];
  const topLegendLine = topLegend
    ? `${topLegend.legend} led the meta with ${topLegend.plays} game${
        topLegend.plays === 1 ? "" : "s"
      } (${fmtPct(topLegend.winRate)} WR).`
    : "";

  const playerCountDelta = previous
    ? current.uniquePlayers - previous.uniquePlayers
    : null;
  const matchCountDelta = previous ? current.matchCount - previous.matchCount : null;

  const excerpt =
    `${current.matchCount} matches played by ${current.uniquePlayers} players. ` +
    (topLegendLine || "");

  const body: Block[] = [];

  // ── Intro ───────────────────────────────────────────────────────
  body.push(h2("By the numbers"));
  const introParts: InlineText[] = [
    `Between ${dateRange}, the community played `,
    { text: `${current.matchCount} matches`, bold: true },
    ` across `,
    { text: `${current.uniquePlayers} players`, bold: true },
    ` using `,
    { text: `${current.legends.length} different legends`, bold: true },
    ".",
  ];
  if (matchCountDelta !== null && previous) {
    introParts.push(
      ` That's ${fmtDelta(matchCountDelta / Math.max(previous.matchCount, 1), "%")} vs last week`,
    );
    if (playerCountDelta !== null && playerCountDelta !== 0) {
      introParts.push(
        `, with ${playerCountDelta > 0 ? "+" : ""}${playerCountDelta} ${
          Math.abs(playerCountDelta) === 1 ? "player" : "players"
        } in the pool`,
      );
    }
    introParts.push(".");
  }
  body.push(p(...introParts));

  // ── Legend movers ───────────────────────────────────────────────
  body.push(h2("Legend meta"));
  body.push(
    p(
      "Top 5 most-played legends this week, sorted by volume. Win rates are only shown when a legend has at least five games logged.",
    ),
  );
  for (const l of current.legends.slice(0, 5)) {
    const wr =
      l.plays >= MIN_WINRATE_SAMPLE ? `${fmtPct(l.winRate)} WR` : "sample too small for WR";
    const prevWr = previous
      ? findBy(previous.legends, (x) => x.legend === l.legend)
      : undefined;
    const trend =
      prevWr && prevWr.plays >= MIN_WINRATE_SAMPLE && l.plays >= MIN_WINRATE_SAMPLE
        ? `, ${fmtDelta(l.winRate - prevWr.winRate)} vs last week`
        : "";
    body.push(
      bullet(
        { text: l.legend, bold: true },
        ` — ${l.plays} game${l.plays === 1 ? "" : "s"} · ${wr}${trend}`,
      ),
    );
  }

  const riser = previous ? biggestLegendMover(current.legends, previous.legends, "up") : null;
  const faller = previous ? biggestLegendMover(current.legends, previous.legends, "down") : null;
  if (riser) {
    body.push(
      p(
        { text: "Biggest riser: ", bold: true },
        `${riser.legend} jumped from ${fmtPct(riser.previous)} to ${fmtPct(
          riser.current,
        )} (${fmtDelta(riser.delta)}). Watch for ${riser.legend} to keep showing up in lineups if the trend holds.`,
      ),
    );
  }
  if (faller) {
    body.push(
      p(
        { text: "Biggest faller: ", bold: true },
        `${faller.legend} dropped from ${fmtPct(faller.previous)} to ${fmtPct(
          faller.current,
        )} (${fmtDelta(faller.delta)}). Might be a metagame adjustment or just a bad week — check again next Monday.`,
      ),
    );
  }

  // ── Decks ───────────────────────────────────────────────────────
  body.push(h2("Deck spotlight"));
  const topDecks = current.decks.slice(0, 3);
  if (topDecks.length > 0) {
    body.push(p("Most-played decks this week:"));
    for (const d of topDecks) {
      const wr =
        d.plays >= MIN_WINRATE_SAMPLE ? ` · ${fmtPct(d.winRate)} WR` : "";
      body.push(
        bullet(
          { text: d.deckName || d.deckKey, bold: true },
          ` — ${d.plays} game${d.plays === 1 ? "" : "s"}${wr}${d.legend ? ` · ${d.legend}` : ""}`,
        ),
      );
    }
  }

  const bestByWinRate = current.decks
    .filter((d) => d.plays >= MIN_WINRATE_SAMPLE)
    .sort((a, b) => b.winRate - a.winRate)[0];
  if (bestByWinRate && bestByWinRate !== topDecks[0]) {
    body.push(
      p(
        { text: "Highest win rate: ", bold: true },
        `${bestByWinRate.deckName || bestByWinRate.deckKey} at ${fmtPct(
          bestByWinRate.winRate,
        )} across ${bestByWinRate.plays} games. Might be under the radar — worth testing on ladder.`,
      ),
    );
  }

  const breakout = previous ? breakoutDecks(current.decks, previous.decks) : [];
  if (breakout.length > 0) {
    const b = breakout[0];
    body.push(
      p(
        { text: "Breakout build: ", bold: true },
        `${b.deckName || b.deckKey} is new this week with ${b.plays} games and a ${fmtPct(
          b.winRate,
        )} win rate. First appearance in the tracked window.`,
      ),
    );
  }

  // ── Players ─────────────────────────────────────────────────────
  body.push(h2("Player spotlight"));
  const mostActive = topPlayerByPlays(current.players);
  const topRate = topPlayerByWinRate(current.players);
  if (mostActive) {
    body.push(
      p(
        { text: "Most active: ", bold: true },
        `${mostActive.username} logged ${mostActive.plays} games${
          mostActive.plays >= MIN_WINRATE_SAMPLE
            ? ` at ${fmtPct(mostActive.winRate)} WR`
            : ""
        }.`,
      ),
    );
  }
  if (topRate && topRate.uid !== mostActive?.uid) {
    body.push(
      p(
        { text: "Top win rate: ", bold: true },
        `${topRate.username} finished the week at ${fmtPct(topRate.winRate)} across ${
          topRate.plays
        } games.`,
      ),
    );
  }

  // ── Battlefields ────────────────────────────────────────────────
  if (current.battlefields.length > 0) {
    const bf = current.battlefields[0];
    if (bf.picks >= MIN_WINRATE_SAMPLE) {
      body.push(h2("Battlefield read"));
      body.push(
        p(
          `${bf.name} was the most-picked battlefield this week (${bf.picks} plays, ${fmtPct(
            bf.winRate,
          )} WR for the picker).`,
        ),
      );
    }
  }

  // ── Closing ─────────────────────────────────────────────────────
  body.push(h2("Next week"));
  body.push(
    p(
      "The next report drops Monday morning. Best way to help shape it is to keep syncing matches — every game tracked sharpens the numbers above. Desktop app's on the ",
      { text: "Download", italic: true },
      " page.",
    ),
  );
  body.push(
    quote(
      "Win rates below five games are not shown because the variance is larger than the signal.",
    ),
  );

  return { title, slug, excerpt, body, tags };
}
