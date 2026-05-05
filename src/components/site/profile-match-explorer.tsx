"use client";

import { useMemo, useState } from "react";

import { LegendChip } from "@/components/site/legend-chip";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { legendHref } from "@/lib/legend-links";
import type { CommunityMatch, DeckEntry, DeckSnapshot, MatchGame } from "@/lib/types";
import { formatDate, formatPercent, safeHref } from "@/lib/utils";

type ProfileMatchExplorerProps = {
  matches: CommunityMatch[];
  handle: string;
  displayName: string;
  showStats: boolean;
  showDecks: boolean;
};

type Filters = {
  search: string;
  legend: string;
  opponent: string;
  result: string;
  format: string;
  deck: string;
  seat: string;
  battlefield: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  legend: "",
  opponent: "",
  result: "",
  format: "",
  deck: "",
  seat: "",
  battlefield: "",
};

function normalized(value: string | undefined | null) {
  return String(value ?? "").trim().toLowerCase();
}

function uniqueOptions(matches: CommunityMatch[], pick: (match: CommunityMatch) => string | string[]) {
  const values = new Set<string>();
  for (const match of matches) {
    const picked = pick(match);
    const list = Array.isArray(picked) ? picked : [picked];
    for (const raw of list) {
      const value = raw.trim();
      if (value) values.add(value);
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function resultTone(result: string) {
  if (result === "Win") return "text-emerald-300";
  if (result === "Loss") return "text-rose-300";
  if (result === "Draw") return "text-amber-200";
  return "text-slate-300";
}

function resultBadgeClass(result: string) {
  if (result === "Win") return "border-emerald-400/30 bg-emerald-400/12 text-emerald-200";
  if (result === "Loss") return "border-rose-400/30 bg-rose-400/12 text-rose-200";
  if (result === "Draw") return "border-amber-400/30 bg-amber-400/12 text-amber-100";
  return "border-white/10 bg-white/[0.04] text-slate-300";
}

function tally(matches: CommunityMatch[]) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const match of matches) {
    if (match.result === "Win") wins += 1;
    else if (match.result === "Loss") losses += 1;
    else if (match.result === "Draw") draws += 1;
  }
  const decisive = wins + losses;
  return {
    matches: matches.length,
    wins,
    losses,
    draws,
    winRate: decisive ? Number(((wins / decisive) * 100).toFixed(1)) : 0,
  };
}

function mostCommon(matches: CommunityMatch[], pick: (match: CommunityMatch) => string) {
  const counts = new Map<string, number>();
  for (const match of matches) {
    const value = pick(match).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
}

function recordFromGames(match: CommunityMatch) {
  if (match.score) return match.score;
  if (!match.games?.length) {
    if (match.result === "Win") return "1-0";
    if (match.result === "Loss") return "0-1";
    if (match.result === "Draw") return "0-0";
    return match.fmt || "Unknown";
  }

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const game of match.games) {
    if (game.result === "Win") wins += 1;
    else if (game.result === "Loss") losses += 1;
    else if (game.result === "Draw") draws += 1;
  }
  return draws ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

function gameRows(match: CommunityMatch): MatchGame[] {
  if (match.games?.length) {
    return match.games.map((game, index) => {
      const shouldUseMatchBattlefields = match.games.length === 1 || (!game.myBf && !game.oppBf);
      return {
        ...game,
        myBf: game.myBf || (shouldUseMatchBattlefields ? match.myBattlefield : ""),
        oppBf: game.oppBf || (shouldUseMatchBattlefields ? match.oppBattlefield : ""),
        wentFirst: game.wentFirst || match.wentFirst || "",
        result: game.result || (index === 0 ? match.result : ""),
      };
    });
  }

  return [
    {
      myBf: match.myBattlefield,
      oppBf: match.oppBattlefield,
      wentFirst: match.wentFirst,
      result: match.result,
      myPoints: 0,
      oppPoints: 0,
    },
  ];
}

function compactDateTime(value: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function deckText(snapshot: DeckSnapshot) {
  const sections: string[] = [];
  const add = (label: string, entries?: DeckEntry[] | null) => {
    if (!entries?.length) return;
    sections.push(`${label}\n${entries.map((entry) => `${entry.qty} ${entry.name}`).join("\n")}`);
  };
  if (snapshot.legendEntry) add("Legend", [snapshot.legendEntry]);
  add("Champion", snapshot.champion);
  add("Main deck", snapshot.mainDeck);
  add("Battlefields", snapshot.battlefields);
  add("Runes", snapshot.runes);
  add("Sideboard", snapshot.sideboard);
  return sections.join("\n\n");
}

function entryCount(entries?: DeckEntry[] | null) {
  return entries?.reduce((sum, entry) => sum + Number(entry.qty || 0), 0) ?? 0;
}

function SelectFilter({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs font-semibold text-slate-400">
      <span>{label}</span>
      <select
        className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "cyan",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "cyan" | "green" | "rose" | "white";
}) {
  const color =
    tone === "green"
      ? "text-emerald-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "white"
          ? "text-white"
          : "text-cyan-200";
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-bold ${color}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function DeckSection({ label, entries }: { label: string; entries?: DeckEntry[] | null }) {
  if (!entries?.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
        <span>{label}</span>
        <span>{entryCount(entries)} cards</span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {entries.map((entry, index) => (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 text-xs"
            key={`${label}-${entry.cardId ?? entry.name}-${index}`}
          >
            <span className="min-w-0 truncate text-slate-200">{entry.name}</span>
            <span className="rounded-lg bg-white/8 px-2 py-0.5 font-bold text-slate-300">
              x{entry.qty}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyDeckTextButton({ snapshot }: { snapshot: DeckSnapshot }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(deckText(snapshot));
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      window.setTimeout(() => setState("idle"), 1800);
    }
  }
  return (
    <Button onClick={copy} size="sm" variant="secondary">
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy deck text"}
    </Button>
  );
}

function DeckSnapshotPanel({
  match,
  showDecks,
}: {
  match: CommunityMatch;
  showDecks: boolean;
}) {
  if (!showDecks) {
    return (
      <Card className="p-5">
        <CardTitle className="text-base">Deck hidden</CardTitle>
        <CardDescription className="mt-2">
          This profile owner has chosen not to show deck details publicly.
        </CardDescription>
      </Card>
    );
  }

  const snapshot = match.deckSnapshot;
  if (!snapshot) {
    return (
      <Card className="p-5">
        <CardTitle className="text-base">{match.deckName || "No deck logged"}</CardTitle>
        <CardDescription className="mt-2">
          This match does not have a public deck snapshot attached.
        </CardDescription>
        {match.deckSourceUrl ? (
          <a
            className="mt-4 inline-flex rounded-full border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-300/10"
            href={safeHref(match.deckSourceUrl)}
            rel="noreferrer"
            target="_blank"
          >
            Open deck source
          </a>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{match.deckName || snapshot.title || "Deck snapshot"}</CardTitle>
          <CardDescription className="mt-1">
            {snapshot.legend || match.myChampion} - public deck data from this match.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyDeckTextButton snapshot={snapshot} />
          {match.deckSourceUrl ? (
            <Button asChild size="sm" variant="secondary">
              <a href={safeHref(match.deckSourceUrl)} rel="noreferrer" target="_blank">
                Open source
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <StatTile label="Main" value={String(entryCount(snapshot.mainDeck))} sub="cards" />
        <StatTile label="Runes" value={String(entryCount(snapshot.runes))} sub="cards" />
        <StatTile label="Battlefields" value={String(entryCount(snapshot.battlefields))} sub="cards" />
        <StatTile label="Sideboard" value={String(entryCount(snapshot.sideboard))} sub="cards" />
      </div>
      <DeckSection label="Legend" entries={snapshot.legendEntry ? [snapshot.legendEntry] : []} />
      <DeckSection label="Champion" entries={snapshot.champion} />
      <DeckSection label="Main deck" entries={snapshot.mainDeck} />
      <DeckSection label="Battlefields" entries={snapshot.battlefields} />
      <DeckSection label="Runes" entries={snapshot.runes} />
      <DeckSection label="Sideboard" entries={snapshot.sideboard} />
    </Card>
  );
}

function MatchDetail({
  match,
  showDecks,
}: {
  match: CommunityMatch;
  showDecks: boolean;
}) {
  const games = gameRows(match);
  return (
    <div className="space-y-4">
      <Card className="space-y-5 border-cyan-300/25 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <LegendChip href={legendHref(match.myChampion)} legend={match.myChampion || "Unknown"} size={34} />
              <span className="text-sm font-semibold text-slate-500">vs</span>
              <LegendChip href={legendHref(match.oppChampion)} legend={match.oppChampion || "Unknown"} size={34} />
            </div>
            <CardTitle className="text-xl">
              {match.myChampion || "Unknown legend"} vs {match.oppChampion || "Unknown opponent"}
            </CardTitle>
            <CardDescription>
              {compactDateTime(match.date)} - {match.fmt || "Unknown format"} - community-submitted match
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className={`rounded-full border px-3 py-1 text-sm font-bold ${resultBadgeClass(match.result)}`}>
              {match.result || "Unknown"} {recordFromGames(match)}
            </span>
            <span className="text-xs text-slate-500">Match ID {match.id.slice(0, 10)}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoBox label="Player" value={match.username || "Unknown player"} />
          <InfoBox label="Opponent" value={match.oppName || "Unknown opponent"} />
          <InfoBox label="Seat" value={match.wentFirst || "Unknown"} />
          <InfoBox label="Deck" value={showDecks ? match.deckName || "No deck logged" : "Hidden"} />
          <InfoBox label="My battlefield" value={match.myBattlefield || games[0]?.myBf || "Unknown"} />
          <InfoBox label="Opponent battlefield" value={match.oppBattlefield || games[0]?.oppBf || "Unknown"} />
          <InfoBox label="Format" value={match.fmt || "Unknown"} />
          <InfoBox label="Source" value="Public profile" />
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Games</div>
          <div className="mt-2 space-y-2">
            {games.map((game, index) => (
              <div
                className="grid gap-2 rounded-2xl border border-white/8 bg-slate-950/30 px-4 py-3 text-sm md:grid-cols-[90px_90px_110px_1fr_1fr]"
                key={`${match.id}-game-${index}`}
              >
                <div className="font-bold text-white">Game {index + 1}</div>
                <div className={resultTone(game.result)}>{game.result || "Unknown"}</div>
                <div className="text-slate-300">{Number(game.myPoints || 0)}-{Number(game.oppPoints || 0)}</div>
                <div className="text-slate-400">{game.wentFirst || "Seat unknown"}</div>
                <div className="min-w-0 text-slate-400">
                  <span className="text-slate-500">BF:</span>{" "}
                  {game.myBf || "Unknown"} vs {game.oppBf || "Unknown"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <DeckSnapshotPanel match={match} showDecks={showDecks} />
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white" title={value}>
        {value}
      </div>
    </div>
  );
}

function DeckPerformance({
  matches,
  showDecks,
  showStats,
  onSelectMatch,
}: {
  matches: CommunityMatch[];
  showDecks: boolean;
  showStats: boolean;
  onSelectMatch: (id: string) => void;
}) {
  const decks = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        title: string;
        legend: string;
        matches: CommunityMatch[];
        sourceUrl: string;
        snapshot: DeckSnapshot | null;
      }
    >();
    for (const match of matches) {
      const title = match.deckName || match.deckSnapshot?.title || "";
      const sourceKey = match.deckSourceKey || match.deckSnapshot?.sourceKey || "";
      const key = sourceKey ? `source:${sourceKey}` : title ? `${normalized(title)}:${normalized(match.myChampion)}` : "";
      if (!key) continue;
      const bucket = groups.get(key) ?? {
        key,
        title: title || "Unnamed deck",
        legend: match.deckSnapshot?.legend || match.myChampion || "Unknown",
        matches: [],
        sourceUrl: match.deckSourceUrl,
        snapshot: match.deckSnapshot,
      };
      bucket.matches.push(match);
      if (!bucket.snapshot && match.deckSnapshot) bucket.snapshot = match.deckSnapshot;
      if (!bucket.sourceUrl && match.deckSourceUrl) bucket.sourceUrl = match.deckSourceUrl;
      groups.set(key, bucket);
    }
    return Array.from(groups.values())
      .map((deck) => ({ ...deck, stats: tally(deck.matches) }))
      .sort((a, b) => b.matches.length - a.matches.length || a.title.localeCompare(b.title));
  }, [matches]);

  if (!showDecks) {
    return (
      <Card className="p-5">
        <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">Decks used</CardTitle>
        <CardDescription className="mt-3">This profile owner has hidden public deck details.</CardDescription>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">Decks used</CardTitle>
      {decks.length ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {decks.map((deck) => (
            <button
              className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.05]"
              key={deck.key}
              type="button"
              onClick={() => onSelectMatch(deck.matches[0].id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-white">{deck.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{deck.legend}</div>
                </div>
                {showStats ? (
                  <div className={`text-lg font-bold ${deck.stats.winRate >= 55 ? "text-emerald-300" : deck.stats.winRate < 45 ? "text-rose-300" : "text-cyan-200"}`}>
                    {formatPercent(deck.stats.winRate)}
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-slate-500">Stats hidden</div>
                )}
              </div>
              {showStats ? (
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-white/6 bg-slate-950/30 px-3 py-2">
                    <div className="text-slate-500">Games</div>
                    <div className="font-bold text-white">{deck.stats.matches}</div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-slate-950/30 px-3 py-2">
                    <div className="text-slate-500">Record</div>
                    <div className="font-bold text-white">{deck.stats.wins}-{deck.stats.losses}</div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-slate-950/30 px-3 py-2">
                    <div className="text-slate-500">Latest</div>
                    <div className="font-bold text-white">{formatDate(deck.matches[0].date)}</div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-slate-500">
                  Deck name is public, but performance stats are hidden by this profile owner.
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <CardDescription className="mt-3">No public deck data is attached to these matches yet.</CardDescription>
      )}
    </Card>
  );
}

export function ProfileMatchExplorer({
  matches,
  handle,
  displayName,
  showStats,
  showDecks,
}: ProfileMatchExplorerProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(matches[0]?.id ?? "");

  const options = useMemo(
    () => ({
      legends: uniqueOptions(matches, (match) => match.myChampion),
      opponents: uniqueOptions(matches, (match) => match.oppChampion),
      results: uniqueOptions(matches, (match) => match.result),
      formats: uniqueOptions(matches, (match) => match.fmt),
      decks: uniqueOptions(matches, (match) => match.deckName || match.deckSnapshot?.title || ""),
      seats: uniqueOptions(matches, (match) => match.wentFirst),
      battlefields: uniqueOptions(matches, (match) => [
        match.myBattlefield,
        match.oppBattlefield,
        ...gameRows(match).flatMap((game) => [game.myBf, game.oppBf]),
      ]),
    }),
    [matches],
  );

  const filtered = useMemo(() => {
    const search = normalized(filters.search);
    return matches.filter((match) => {
      const games = gameRows(match);
      if (filters.legend && match.myChampion !== filters.legend) return false;
      if (filters.opponent && match.oppChampion !== filters.opponent) return false;
      if (filters.result && match.result !== filters.result) return false;
      if (filters.format && match.fmt !== filters.format) return false;
      if (filters.deck && (match.deckName || match.deckSnapshot?.title || "") !== filters.deck) return false;
      if (filters.seat && match.wentFirst !== filters.seat && !games.some((game) => game.wentFirst === filters.seat)) return false;
      if (filters.battlefield) {
        const fields = [match.myBattlefield, match.oppBattlefield, ...games.flatMap((game) => [game.myBf, game.oppBf])];
        if (!fields.includes(filters.battlefield)) return false;
      }
      if (!search) return true;
      const haystack = [
        match.username,
        match.oppName,
        match.myChampion,
        match.oppChampion,
        match.deckName,
        match.deckSourceKey,
        match.myBattlefield,
        match.oppBattlefield,
        match.fmt,
        match.result,
        ...games.flatMap((game) => [game.myBf, game.oppBf, game.wentFirst, game.result]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [filters, matches]);

  const selected = filtered.find((match) => match.id === selectedId) ?? filtered[0] ?? matches.find((match) => match.id === selectedId) ?? matches[0];
  const stats = tally(filtered);
  const topLegend = mostCommon(filtered, (match) => match.myChampion);
  const topOpponent = mostCommon(filtered, (match) => match.oppChampion);
  const topDeck = showDecks ? mostCommon(filtered, (match) => match.deckName || match.deckSnapshot?.title || "") : undefined;

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function selectMatch(id: string) {
    setSelectedId(id);
    window.setTimeout(() => {
      document.getElementById("profile-match-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  if (!matches.length) {
    return (
      <Card>
        <CardTitle>No public matches visible</CardTitle>
        <CardDescription className="mt-2">
          {displayName || handle} has a public RiftLite profile, but no opted-in public matches are available yet.
        </CardDescription>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Public match explorer</CardTitle>
            <CardDescription className="mt-1">
              Filter the cached public match window, then click a row to inspect games, battlefields, and deck snapshots.
            </CardDescription>
          </div>
          <Button onClick={() => setFilters(EMPTY_FILTERS)} size="sm" variant="secondary">
            Reset filters
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5 text-xs font-semibold text-slate-400 xl:col-span-2">
            <span>Search</span>
            <input
              className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
              placeholder="Player, opponent, legend, battlefield, deck..."
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
            />
          </label>
          <SelectFilter label="My legend" value={filters.legend} options={options.legends} allLabel="All legends" onChange={(value) => updateFilter("legend", value)} />
          <SelectFilter label="Opponent legend" value={filters.opponent} options={options.opponents} allLabel="All opponents" onChange={(value) => updateFilter("opponent", value)} />
          <SelectFilter label="Result" value={filters.result} options={options.results} allLabel="All results" onChange={(value) => updateFilter("result", value)} />
          <SelectFilter label="Format" value={filters.format} options={options.formats} allLabel="All formats" onChange={(value) => updateFilter("format", value)} />
          {showDecks ? <SelectFilter label="Deck" value={filters.deck} options={options.decks} allLabel="All decks" onChange={(value) => updateFilter("deck", value)} /> : null}
          <SelectFilter label="Seat" value={filters.seat} options={options.seats} allLabel="All seats" onChange={(value) => updateFilter("seat", value)} />
          <SelectFilter label="Battlefield" value={filters.battlefield} options={options.battlefields} allLabel="All battlefields" onChange={(value) => updateFilter("battlefield", value)} />
        </div>
      </Card>

      {showStats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Shown" value={String(stats.matches)} sub={`${matches.length} public matches loaded`} />
          <StatTile label="Win rate" value={formatPercent(stats.winRate)} tone={stats.winRate >= 55 ? "green" : stats.winRate < 45 ? "rose" : "cyan"} />
          <StatTile label="Record" value={`${stats.wins}-${stats.losses}`} sub={stats.draws ? `${stats.draws} draws` : "Decisive only"} />
          <StatTile label="Top legend" value={topLegend?.[0] ?? "None"} sub={topLegend ? `${topLegend[1]} games` : undefined} />
          <StatTile label={showDecks ? "Top deck" : "Top opponent"} value={(showDecks ? topDeck?.[0] : topOpponent?.[0]) ?? "None"} sub={showDecks ? (topDeck ? `${topDeck[1]} games` : undefined) : (topOpponent ? `${topOpponent[1]} games` : undefined)} />
        </div>
      ) : (
        <Card>
          <CardTitle>Stats hidden</CardTitle>
          <CardDescription className="mt-2">
            This player has made their profile public but kept profile stats private.
          </CardDescription>
        </Card>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(520px,0.85fr)_1.15fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-white/8 px-5 py-4">
            <CardTitle className="text-sm uppercase tracking-[0.18em] text-slate-500">
              Recent public matches ({filtered.length})
            </CardTitle>
          </div>
          {filtered.length ? (
            <div className="max-h-[760px] overflow-y-auto">
              {filtered.map((match) => {
                const active = selected?.id === match.id;
                return (
                  <button
                    className={`grid w-full gap-3 border-b border-white/[0.05] px-5 py-4 text-left transition hover:bg-white/[0.04] lg:grid-cols-[1fr_auto] ${active ? "bg-cyan-300/[0.08] ring-1 ring-inset ring-cyan-300/35" : ""}`}
                    key={match.id}
                    type="button"
                    onClick={() => selectMatch(match.id)}
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <LegendChip href={legendHref(match.myChampion)} legend={match.myChampion || "Unknown"} size={26} />
                        <span className="text-xs text-slate-600">vs</span>
                        <LegendChip href={legendHref(match.oppChampion)} legend={match.oppChampion || "Unknown"} size={26} />
                      </div>
                      <div className="truncate text-sm font-bold text-white">
                        {match.username || displayName || handle} vs {match.oppName || "Unknown opponent"}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {formatDate(match.date)} - {match.myChampion || "Unknown"} vs {match.oppChampion || "Unknown"}
                        {showDecks ? ` - ${match.deckName || "No deck logged"}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:block lg:text-right">
                      <div className={`font-bold ${resultTone(match.result)}`}>
                        {match.result || "Unknown"} {recordFromGames(match)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{match.fmt || "Unknown format"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">No matches fit those filters yet.</div>
          )}
        </Card>

        <div id="profile-match-detail" className="min-w-0">
          {selected ? (
            <MatchDetail match={selected} showDecks={showDecks} />
          ) : (
            <Card>
              <CardDescription>No match selected.</CardDescription>
            </Card>
          )}
        </div>
      </div>

      <DeckPerformance matches={filtered} showDecks={showDecks} showStats={showStats} onSelectMatch={selectMatch} />
    </div>
  );
}
