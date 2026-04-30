"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, RotateCcw, Save, Send, Smartphone } from "lucide-react";

import { canonicalChoice, type CanonicalAliasMap, type CanonicalChoiceList, hasInvalidChoice } from "@/lib/canonical";
import { BATTLEFIELD_ALIASES, BATTLEFIELDS, LEGEND_ALIASES, LEGENDS } from "@/lib/constants";

type ScorepadResult = "Win" | "Loss" | "Draw" | "Incomplete";
type ScorepadFormat = "Bo1" | "Bo3";
type ScorepadSeat = "1st" | "2nd" | "";

type ScorepadGame = {
  result: ScorepadResult;
  myPoints: number;
  oppPoints: number;
  wentFirst: ScorepadSeat;
  myBattlefield: string;
  oppBattlefield: string;
};

type ScorepadMatch = {
  localId: string;
  capturedAt: string;
  format: ScorepadFormat;
  result: ScorepadResult;
  myName: string;
  opponentName: string;
  myChampion: string;
  opponentChampion: string;
  deckName: string;
  eventName: string;
  roundName: string;
  notes: string;
  games: ScorepadGame[];
  syncStatus: "saved" | "synced" | "failed";
};

type PhoneLink = {
  deviceId: string;
  secret: string;
};

const STORAGE_KEY = "riftlite-scorepad-matches";
const LINK_KEY = "riftlite-scorepad-link";

export function ScorepadClient() {
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [matches, setMatches] = useState<ScorepadMatch[]>([]);
  const [status, setStatus] = useState("");
  const [format, setFormat] = useState<ScorepadFormat>("Bo1");
  const [myName, setMyName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [myChampion, setMyChampion] = useState("");
  const [opponentChampion, setOpponentChampion] = useState("");
  const [deckName, setDeckName] = useState("");
  const [eventName, setEventName] = useState("");
  const [roundName, setRoundName] = useState("");
  const [notes, setNotes] = useState("");
  const [games, setGames] = useState<ScorepadGame[]>([emptyGame()]);

  const visibleGames = useMemo(() => format === "Bo3" ? ensureBo3(games) : [games[0] ?? emptyGame()], [format, games]);
  const record = useMemo(() => matchRecord(visibleGames), [visibleGames]);
  const unsynced = matches.filter((match) => match.syncStatus !== "synced");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const deviceId = hash.get("device")?.trim() ?? "";
    const secret = hash.get("secret")?.trim() ?? "";
    const storedLink = readJson<PhoneLink>(LINK_KEY);
    const nextLink = deviceId && secret ? { deviceId, secret } : storedLink;
    if (nextLink?.deviceId && nextLink.secret) {
      setLink(nextLink);
      window.localStorage.setItem(LINK_KEY, JSON.stringify(nextLink));
      setStatus(deviceId ? "Phone linked to RiftLite Desktop." : "Phone link loaded.");
    }
    setMatches(readJson<ScorepadMatch[]>(STORAGE_KEY) ?? []);
  }, []);

  function updateMatches(next: ScorepadMatch[]) {
    setMatches(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function patchGame(index: number, patch: Partial<ScorepadGame>) {
    setGames((current) => {
      const next = format === "Bo3" ? ensureBo3(current) : [current[0] ?? emptyGame()];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function changeScore(index: number, side: "me" | "opp", delta: number) {
    const game = visibleGames[index] ?? emptyGame();
    const key = side === "me" ? "myPoints" : "oppPoints";
    patchGame(index, { [key]: Math.max(0, game[key] + delta) });
  }

  function addGame() {
    setFormat("Bo3");
    setGames((current) => ensureBo3(current).slice(0, Math.min(3, current.length + 1)));
  }

  function resetForm() {
    setFormat("Bo1");
    setOpponentName("");
    setMyChampion("");
    setOpponentChampion("");
    setDeckName("");
    setEventName("");
    setRoundName("");
    setNotes("");
    setGames([emptyGame()]);
  }

  function saveLocal() {
    const selectedGames = format === "Bo3"
      ? visibleGames.filter((game, index) => index < 2 || hasGameData(game))
      : [visibleGames[0] ?? emptyGame()];
    const validationError = validateChoices(myChampion, opponentChampion, selectedGames);
    if (validationError) {
      setStatus(validationError);
      return;
    }
    const canonicalGames = selectedGames.map((game) => ({
      ...game,
      myBattlefield: canonicalChoice(game.myBattlefield, BATTLEFIELDS, BATTLEFIELD_ALIASES),
      oppBattlefield: canonicalChoice(game.oppBattlefield, BATTLEFIELDS, BATTLEFIELD_ALIASES),
    }));
    const match: ScorepadMatch = {
      localId: `phone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: new Date().toISOString(),
      format: canonicalGames.length > 1 ? "Bo3" : "Bo1",
      result: record.result,
      myName,
      opponentName,
      myChampion: canonicalChoice(myChampion, LEGENDS, LEGEND_ALIASES),
      opponentChampion: canonicalChoice(opponentChampion, LEGENDS, LEGEND_ALIASES),
      deckName,
      eventName,
      roundName,
      notes,
      games: canonicalGames,
      syncStatus: "saved",
    };
    updateMatches([match, ...matches]);
    resetForm();
    setStatus("Saved on this phone.");
  }

  async function syncSaved() {
    if (!link) {
      setStatus("Open this page from the desktop phone link first.");
      return;
    }
    if (!unsynced.length) {
      setStatus("Everything on this phone is already synced.");
      return;
    }
    setStatus(`Syncing ${unsynced.length} saved match${unsynced.length === 1 ? "" : "es"}...`);
    const next = [...matches];
    for (const match of unsynced) {
      const response = await fetch("/api/scorepad/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...link, match }),
      });
      const index = next.findIndex((item) => item.localId === match.localId);
      if (index >= 0) {
        next[index] = { ...next[index], syncStatus: response.ok ? "synced" : "failed" };
      }
    }
    updateMatches(next);
    setStatus("Sync attempt complete. Open RiftLite Desktop and import phone logs.");
  }

  return (
    <main className="min-h-screen px-4 py-5 text-white">
      <ChoiceDatalist id="scorepad-legends" options={LEGENDS} />
      <ChoiceDatalist id="scorepad-battlefields" options={BATTLEFIELDS} />
      <section className="mx-auto grid max-w-5xl gap-4">
        <header className="rounded-2xl border border-sky-400/30 bg-[#101936] p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-sky-200">RiftLite</p>
              <h1 className="text-4xl font-black">Scorepad</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">Score a table game live or quick-log it after. Everything saves on this phone first, then syncs to your linked desktop inbox.</p>
            </div>
            <div className="rounded-xl border border-sky-300/30 bg-slate-950/60 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-sky-100"><Smartphone size={16} /> {link ? "Linked" : "Not linked"}</div>
              <p className="mt-1 text-slate-400">{unsynced.length} waiting to sync</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-sky-400/25 bg-[#0d1428] p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-sm font-bold text-slate-300">Format<select className="rounded-lg border border-sky-500/40 bg-slate-950 p-3" value={format} onChange={(event) => setFormat(event.target.value as ScorepadFormat)}><option>Bo1</option><option>Bo3</option></select></label>
              <Field label="My name" value={myName} onChange={setMyName} />
              <Field label="Opponent" value={opponentName} onChange={setOpponentName} />
              <Field label="Deck" value={deckName} onChange={setDeckName} />
              <ChoiceField label="My legend" value={myChampion} onChange={setMyChampion} options={LEGENDS} aliases={LEGEND_ALIASES} listId="scorepad-legends" placeholder="Search legends" />
              <ChoiceField label="Opponent legend" value={opponentChampion} onChange={setOpponentChampion} options={LEGENDS} aliases={LEGEND_ALIASES} listId="scorepad-legends" placeholder="Search legends" />
              <Field label="Event" value={eventName} onChange={setEventName} placeholder="Nexus Night" />
              <Field label="Round" value={roundName} onChange={setRoundName} placeholder="Round 2" />
            </div>

            <div className={`mt-4 grid gap-3 ${format === "Bo3" ? "lg:grid-cols-3" : ""}`}>
              {visibleGames.map((game, index) => (
                <article className="grid gap-3 rounded-xl border border-sky-500/30 bg-slate-950/55 p-3" key={index}>
                  <div className="flex items-center justify-between">
                    <strong>Game {index + 1}</strong>
                    <span className="text-lg font-black text-sky-200">{game.myPoints}-{game.oppPoints}</span>
                  </div>
                  <label className="grid gap-1 text-sm font-bold text-slate-300">Result<select className="rounded-lg border border-sky-500/40 bg-slate-950 p-3" value={game.result} onChange={(event) => patchGame(index, { result: event.target.value as ScorepadResult })}><option>Incomplete</option><option>Win</option><option>Loss</option><option>Draw</option></select></label>
                  <div className="grid grid-cols-[40px_1fr_40px] gap-2">
                    <button className="rounded-lg border border-sky-500/40 bg-slate-900 p-2" onClick={() => changeScore(index, "me", -1)}><Minus size={16} /></button>
                    <div className="rounded-lg border border-sky-500/20 bg-slate-900 p-2 text-center"><span className="text-xs text-slate-400">Me</span><strong className="block text-2xl">{game.myPoints}</strong></div>
                    <button className="rounded-lg border border-sky-500/40 bg-slate-900 p-2" onClick={() => changeScore(index, "me", 1)}><Plus size={16} /></button>
                  </div>
                  <div className="grid grid-cols-[40px_1fr_40px] gap-2">
                    <button className="rounded-lg border border-sky-500/40 bg-slate-900 p-2" onClick={() => changeScore(index, "opp", -1)}><Minus size={16} /></button>
                    <div className="rounded-lg border border-sky-500/20 bg-slate-900 p-2 text-center"><span className="text-xs text-slate-400">Opponent</span><strong className="block text-2xl">{game.oppPoints}</strong></div>
                    <button className="rounded-lg border border-sky-500/40 bg-slate-900 p-2" onClick={() => changeScore(index, "opp", 1)}><Plus size={16} /></button>
                  </div>
                  <label className="grid gap-1 text-sm font-bold text-slate-300">Seat<select className="rounded-lg border border-sky-500/40 bg-slate-950 p-3" value={game.wentFirst} onChange={(event) => patchGame(index, { wentFirst: event.target.value as ScorepadSeat })}><option value="">Unknown</option><option value="1st">Went 1st</option><option value="2nd">Went 2nd</option></select></label>
                  <ChoiceField label="My battlefield" value={game.myBattlefield} onChange={(value) => patchGame(index, { myBattlefield: value })} options={BATTLEFIELDS} aliases={BATTLEFIELD_ALIASES} listId="scorepad-battlefields" placeholder="Search battlefields" />
                  <ChoiceField label="Opponent battlefield" value={game.oppBattlefield} onChange={(value) => patchGame(index, { oppBattlefield: value })} options={BATTLEFIELDS} aliases={BATTLEFIELD_ALIASES} listId="scorepad-battlefields" placeholder="Search battlefields" />
                </article>
              ))}
            </div>

            <label className="mt-4 grid gap-1 text-sm font-bold text-slate-300">Notes<textarea className="min-h-24 rounded-lg border border-sky-500/40 bg-slate-950 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="mt-4 flex flex-wrap gap-2">
              {format === "Bo3" && visibleGames.length < 3 ? <button className="rounded-xl border border-sky-500/40 px-4 py-3 font-bold" onClick={addGame}><Plus className="inline" size={16} /> Add game</button> : null}
              <button className="rounded-xl border border-sky-500/40 px-4 py-3 font-bold" onClick={resetForm}><RotateCcw className="inline" size={16} /> Reset</button>
              <button className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-3 font-black text-slate-950" onClick={saveLocal}><Save className="inline" size={16} /> Save on phone</button>
            </div>
          </div>

          <aside className="grid gap-4">
            <section className="rounded-2xl border border-sky-400/25 bg-[#0d1428] p-4">
              <h2 className="text-xl">Sync</h2>
              <p className="mt-2 text-sm text-slate-300">{status || "Save matches on this phone, then sync when linked."}</p>
              <button className="mt-4 w-full rounded-xl bg-sky-300 px-4 py-3 font-black text-slate-950" onClick={() => void syncSaved()}><Send className="inline" size={16} /> Sync to RiftLite</button>
            </section>
            <section className="rounded-2xl border border-sky-400/25 bg-[#0d1428] p-4">
              <h2 className="text-xl">Saved</h2>
              <div className="mt-3 grid max-h-[420px] gap-2 overflow-auto pr-1">
                {matches.map((match) => (
                  <article className="rounded-xl border border-sky-500/25 bg-slate-950/55 p-3 text-sm" key={match.localId}>
                    <div className="flex items-center justify-between gap-2">
                      <strong>{match.myChampion || "You"} vs {match.opponentChampion || "Opponent"}</strong>
                      <span className="text-sky-200">{match.result}</span>
                    </div>
                    <p className="mt-1 text-slate-400">{new Date(match.capturedAt).toLocaleString()} - {match.format}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">{match.syncStatus === "synced" ? <Check size={13} /> : null}{match.syncStatus}</p>
                  </article>
                ))}
                {!matches.length ? <p className="text-sm text-slate-400">No matches saved on this phone yet.</p> : null}
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

function Field({ label, value, onChange, placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-300">
      {label}
      <input className="rounded-lg border border-sky-500/40 bg-slate-950 p-3" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function ChoiceField({
  label,
  value,
  onChange,
  options,
  aliases = {},
  listId,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: CanonicalChoiceList;
  aliases?: CanonicalAliasMap;
  listId: string;
  placeholder: string;
}) {
  function commitChoice() {
    const canonical = canonicalChoice(value, options, aliases);
    onChange(canonical);
  }

  return (
    <label className="grid gap-1 text-sm font-bold text-slate-300">
      {label}
      <input
        autoComplete="off"
        className="rounded-lg border border-sky-500/40 bg-slate-950 p-3"
        list={listId}
        onBlur={commitChoice}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ChoiceDatalist({ id, options }: { id: string; options: CanonicalChoiceList }) {
  return (
    <datalist id={id}>
      {options.map((option) => (
        <option key={option} value={option} />
      ))}
    </datalist>
  );
}

function emptyGame(): ScorepadGame {
  return {
    result: "Incomplete",
    myPoints: 0,
    oppPoints: 0,
    wentFirst: "",
    myBattlefield: "",
    oppBattlefield: "",
  };
}

function ensureBo3(games: ScorepadGame[]): ScorepadGame[] {
  const next = games.length ? [...games] : [emptyGame()];
  while (next.length < 2) next.push(emptyGame());
  return next.slice(0, 3);
}

function hasGameData(game: ScorepadGame): boolean {
  return game.result !== "Incomplete" || game.myPoints > 0 || game.oppPoints > 0 || Boolean(game.myBattlefield || game.oppBattlefield || game.wentFirst);
}

function validateChoices(myChampion: string, opponentChampion: string, games: ScorepadGame[]): string {
  if (hasInvalidChoice(myChampion, LEGENDS, LEGEND_ALIASES)) {
    return "Choose a suggested value for My legend.";
  }
  if (hasInvalidChoice(opponentChampion, LEGENDS, LEGEND_ALIASES)) {
    return "Choose a suggested value for Opponent legend.";
  }
  const invalidGameIndex = games.findIndex((game) =>
    hasInvalidChoice(game.myBattlefield, BATTLEFIELDS, BATTLEFIELD_ALIASES) ||
    hasInvalidChoice(game.oppBattlefield, BATTLEFIELDS, BATTLEFIELD_ALIASES)
  );
  return invalidGameIndex >= 0 ? `Choose suggested battlefield values for Game ${invalidGameIndex + 1}.` : "";
}

function matchRecord(games: ScorepadGame[]): { result: ScorepadResult; score: string } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const game of games) {
    if (game.result === "Win") wins += 1;
    if (game.result === "Loss") losses += 1;
    if (game.result === "Draw") draws += 1;
  }
  if (wins > losses) return { result: "Win", score: `${wins}-${losses}${draws ? `-${draws}` : ""}` };
  if (losses > wins) return { result: "Loss", score: `${wins}-${losses}${draws ? `-${draws}` : ""}` };
  if (draws) return { result: "Draw", score: `${wins}-${losses}-${draws}` };
  return { result: "Incomplete", score: "" };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}
