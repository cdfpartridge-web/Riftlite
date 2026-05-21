"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Send,
  Shield,
  Smartphone,
  Sparkles,
  Swords,
  Wifi,
  WifiOff,
} from "lucide-react";

import { canonicalChoice, type CanonicalAliasMap, type CanonicalChoiceList, hasInvalidChoice } from "@/lib/canonical";
import { BATTLEFIELD_ALIASES, BATTLEFIELDS, LEGEND_ALIASES, LEGENDS } from "@/lib/constants";

type ScorepadResult = "Win" | "Loss" | "Draw" | "Incomplete";
type ScorepadFormat = "Bo1" | "Bo3";
type ScorepadSeat = "1st" | "2nd" | "undecided" | "";
type ScorepadMode = "live" | "quick";

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
  clientSavedAt?: string;
  appVersion?: string;
  deviceLabel?: string;
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
const DB_NAME = "riftlite-scorepad";
const DB_STORE = "matches";
const DB_VERSION = 1;
const SCOREPAD_APP_VERSION = "scorepad-pwa-v1";

export function ScorepadClient() {
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [matches, setMatches] = useState<ScorepadMatch[]>([]);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<ScorepadMode>("live");
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [online, setOnline] = useState(true);
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
  const hasLink = Boolean(link?.deviceId && link.secret);

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

    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void loadStoredMatches().then((storedMatches) => {
      setMatches(storedMatches);
      setLoadingSaved(false);
    });
    registerScorepadServiceWorker();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function persistMatches(next: ScorepadMatch[]) {
    setMatches(next);
    await writeStoredMatches(next);
  }

  function patchGame(index: number, patch: Partial<ScorepadGame>) {
    setGames((current) => {
      const next = format === "Bo3" ? ensureBo3(current) : [current[0] ?? emptyGame()];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function changeFormat(nextFormat: ScorepadFormat) {
    setFormat(nextFormat);
    setGames((current) => nextFormat === "Bo3" ? ensureBo3(current) : [current[0] ?? emptyGame()]);
  }

  function changeScore(index: number, side: "me" | "opp", delta: number) {
    const game = visibleGames[index] ?? emptyGame();
    const key = side === "me" ? "myPoints" : "oppPoints";
    patchGame(index, { [key]: Math.max(0, game[key] + delta) });
  }

  function addGame() {
    changeFormat("Bo3");
    setGames((current) => {
      const next = ensureBo3(current);
      if (next.length >= 3) {
        return next.slice(0, 3);
      }
      return [...next, emptyGame()].slice(0, 3);
    });
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
    const savedRecord = matchRecord(canonicalGames);
    const savedAt = new Date().toISOString();
    const match: ScorepadMatch = {
      localId: createLocalId(),
      capturedAt: savedAt,
      clientSavedAt: savedAt,
      appVersion: SCOREPAD_APP_VERSION,
      deviceLabel: "RiftLite Scorepad",
      format: canonicalGames.length > 1 ? "Bo3" : "Bo1",
      result: savedRecord.result,
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
    void persistMatches([match, ...matches]);
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
      try {
        const response = await fetch("/api/scorepad/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...link, match }),
        });
        const index = next.findIndex((item) => item.localId === match.localId);
        if (index >= 0) {
          next[index] = { ...next[index], syncStatus: response.ok ? "synced" : "failed" };
        }
      } catch {
        const index = next.findIndex((item) => item.localId === match.localId);
        if (index >= 0) {
          next[index] = { ...next[index], syncStatus: "failed" };
        }
      }
    }
    await persistMatches(next);
    setStatus("Sync attempt complete. Open RiftLite Desktop and import phone logs.");
  }

  return (
    <div className="scorepad-app-shell min-h-screen bg-[#050a14] px-3 py-4 text-white sm:px-4">
      <ChoiceDatalist id="scorepad-legends" options={LEGENDS} />
      <ChoiceDatalist id="scorepad-battlefields" options={BATTLEFIELDS} />
      <section className="mx-auto grid max-w-6xl gap-4">
        <header className="overflow-hidden rounded-[1.75rem] border border-sky-400/25 bg-[#0b1428] shadow-2xl shadow-black/40">
          <div className="relative grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(45,212,255,0.28),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(168,85,247,0.22),transparent_34%)]" />
            <div className="relative flex items-center gap-4">
              <img alt="" className="h-16 w-16 rounded-2xl object-contain shadow-lg shadow-sky-500/15" src="/brand/riftlite-logo-transparent.webp" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-200">RiftLite</p>
                <h1 className="text-4xl font-black leading-none sm:text-5xl">Scorepad</h1>
                <p className="mt-2 max-w-2xl text-sm text-slate-200">Live scoring for table games, with private phone storage and desktop review before anything joins your history.</p>
              </div>
            </div>
            <div className="relative grid grid-cols-3 gap-2 text-center text-xs sm:min-w-72">
              <StatusTile icon={online ? <Wifi size={15} /> : <WifiOff size={15} />} label={online ? "Online" : "Offline"} value={online ? "Ready" : "Saved locally"} />
              <StatusTile icon={<Smartphone size={15} />} label="Desktop" value={hasLink ? "Linked" : "No link"} />
              <StatusTile icon={<Shield size={15} />} label="Pending" value={String(unsynced.length)} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/20 bg-[#0c1324] p-3">
              <div className="inline-grid grid-cols-2 rounded-2xl border border-sky-400/25 bg-slate-950/70 p-1">
                <button className={`rounded-xl px-4 py-3 text-sm font-black ${mode === "live" ? "bg-sky-300 text-slate-950" : "text-slate-300"}`} onClick={() => setMode("live")}>
                  <Swords className="mr-2 inline" size={16} /> Live Score
                </button>
                <button className={`rounded-xl px-4 py-3 text-sm font-black ${mode === "quick" ? "bg-sky-300 text-slate-950" : "text-slate-300"}`} onClick={() => setMode("quick")}>
                  <ClipboardList className="mr-2 inline" size={16} /> Quick Log
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-sky-400/20 bg-slate-950/55 px-3 py-2">
                <Sparkles size={16} className="text-sky-200" />
                <span className="text-sm text-slate-300">{record.score ? `Match record ${record.score}` : "Ready to score"}</span>
              </div>
            </div>

            <section className="rounded-3xl border border-sky-400/25 bg-[#0b1326] p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="grid gap-1 text-sm font-bold text-slate-300">
                  Format
                  <select className="min-h-12 rounded-xl border border-sky-500/40 bg-slate-950 p-3" value={format} onChange={(event) => changeFormat(event.target.value as ScorepadFormat)}>
                    <option>Bo1</option>
                    <option>Bo3</option>
                  </select>
                </label>
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
                  <article className="grid gap-3 rounded-2xl border border-sky-500/30 bg-slate-950/55 p-3" key={index}>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-lg">Game {index + 1}</strong>
                      <span className="rounded-full border border-sky-400/30 bg-sky-300/10 px-3 py-1 text-xl font-black text-sky-100">{game.myPoints}-{game.oppPoints}</span>
                    </div>
                    <label className="grid gap-1 text-sm font-bold text-slate-300">
                      Result
                      <select className="min-h-12 rounded-xl border border-sky-500/40 bg-slate-950 p-3" value={game.result} onChange={(event) => patchGame(index, { result: event.target.value as ScorepadResult })}>
                        <option>Incomplete</option>
                        <option>Win</option>
                        <option>Loss</option>
                        <option>Draw</option>
                      </select>
                    </label>
                    <ScoreStepper label="Me" value={game.myPoints} onMinus={() => changeScore(index, "me", -1)} onPlus={() => changeScore(index, "me", 1)} />
                    <ScoreStepper label="Opponent" value={game.oppPoints} onMinus={() => changeScore(index, "opp", -1)} onPlus={() => changeScore(index, "opp", 1)} />
                    <label className="grid gap-1 text-sm font-bold text-slate-300">
                      Seat
                      <select className="min-h-12 rounded-xl border border-sky-500/40 bg-slate-950 p-3" value={game.wentFirst} onChange={(event) => patchGame(index, { wentFirst: event.target.value as ScorepadSeat })}>
                        <option value="">Unknown</option>
                        <option value="1st">Went 1st</option>
                        <option value="2nd">Went 2nd</option>
                        <option value="undecided">Undecided</option>
                      </select>
                    </label>
                    <ChoiceField label="My battlefield" value={game.myBattlefield} onChange={(value) => patchGame(index, { myBattlefield: value })} options={BATTLEFIELDS} aliases={BATTLEFIELD_ALIASES} listId="scorepad-battlefields" placeholder="Search battlefields" />
                    <ChoiceField label="Opponent battlefield" value={game.oppBattlefield} onChange={(value) => patchGame(index, { oppBattlefield: value })} options={BATTLEFIELDS} aliases={BATTLEFIELD_ALIASES} listId="scorepad-battlefields" placeholder="Search battlefields" />
                  </article>
                ))}
              </div>

              <label className="mt-4 grid gap-1 text-sm font-bold text-slate-300">
                Notes
                <textarea className="min-h-24 rounded-xl border border-sky-500/40 bg-slate-950 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={mode === "live" ? "Key plays, judge call, opponent conceded..." : "Anything useful for review..."} />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                {format === "Bo3" && visibleGames.length < 3 ? <button className="min-h-12 rounded-xl border border-sky-500/40 px-4 py-3 font-bold" onClick={addGame}><Plus className="mr-2 inline" size={16} /> Add game</button> : null}
                <button className="min-h-12 rounded-xl border border-sky-500/40 px-4 py-3 font-bold" onClick={resetForm}><RotateCcw className="mr-2 inline" size={16} /> Reset</button>
                <button className="min-h-12 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-3 font-black text-slate-950" onClick={saveLocal}><Save className="mr-2 inline" size={16} /> Save on phone</button>
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded-3xl border border-sky-400/25 bg-[#0b1326] p-4">
              <h2 className="text-xl font-black">Phone sync</h2>
              <p className="mt-2 text-sm text-slate-300">{status || (loadingSaved ? "Loading saved phone matches..." : "Saved matches stay here until you sync them.")}</p>
              <button className="mt-4 min-h-12 w-full rounded-xl bg-sky-300 px-4 py-3 font-black text-slate-950" onClick={() => void syncSaved()}><Send className="mr-2 inline" size={16} /> Sync to RiftLite</button>
              {!hasLink ? <p className="mt-3 text-xs text-slate-400">Create the phone link in RiftLite Desktop, scan the QR once, then this app can keep saving offline.</p> : null}
            </section>
            <section className="rounded-3xl border border-sky-400/25 bg-[#0b1326] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-black">Saved</h2>
                <span className="rounded-full border border-sky-400/30 px-3 py-1 text-xs text-sky-100">{matches.length}</span>
              </div>
              <div className="mt-3 grid max-h-[520px] gap-2 overflow-auto pr-1">
                {matches.map((match) => (
                  <article className="rounded-2xl border border-sky-500/25 bg-slate-950/55 p-3 text-sm" key={match.localId}>
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
    </div>
  );
}

function StatusTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-sky-300/25 bg-slate-950/55 px-3 py-2">
      <div className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full bg-sky-300/10 text-sky-100">{icon}</div>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate font-black text-sky-100">{value}</p>
    </div>
  );
}

function ScoreStepper({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="grid grid-cols-[52px_1fr_52px] gap-2">
      <button aria-label={`Decrease ${label}`} className="min-h-14 rounded-xl border border-sky-500/40 bg-slate-900 p-2" onClick={onMinus}><Minus className="mx-auto" size={18} /></button>
      <div className="rounded-xl border border-sky-500/20 bg-slate-900 p-2 text-center">
        <span className="text-xs text-slate-400">{label}</span>
        <strong className="block text-3xl leading-none">{value}</strong>
      </div>
      <button aria-label={`Increase ${label}`} className="min-h-14 rounded-xl border border-sky-500/40 bg-slate-900 p-2" onClick={onPlus}><Plus className="mx-auto" size={18} /></button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-300">
      {label}
      <input className="min-h-12 rounded-xl border border-sky-500/40 bg-slate-950 p-3" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
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
  const invalid = hasInvalidChoice(value, options, aliases);

  function commitChoice() {
    const canonical = canonicalChoice(value, options, aliases);
    onChange(canonical);
  }

  return (
    <label className="grid gap-1 text-sm font-bold text-slate-300">
      {label}
      <input
        autoComplete="off"
        className={`min-h-12 rounded-xl border bg-slate-950 p-3 ${invalid ? "border-rose-400/80" : "border-sky-500/40"}`}
        list={listId}
        onBlur={commitChoice}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {invalid ? <span className="text-xs text-rose-200">Choose a suggested value.</span> : null}
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

function createLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `phone-${crypto.randomUUID()}`;
  }
  return `phone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

async function loadStoredMatches(): Promise<ScorepadMatch[]> {
  const db = await openScorepadDb();
  if (!db) {
    return readJson<ScorepadMatch[]>(STORAGE_KEY) ?? [];
  }
  const indexedMatches = await readMatchesFromDb(db);
  if (indexedMatches.length) {
    return indexedMatches.sort(sortNewestFirst);
  }
  const migrated = readJson<ScorepadMatch[]>(STORAGE_KEY) ?? [];
  if (migrated.length) {
    await writeMatchesToDb(db, migrated);
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return migrated.sort(sortNewestFirst);
}

async function writeStoredMatches(matches: ScorepadMatch[]): Promise<void> {
  const db = await openScorepadDb();
  if (!db) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
    return;
  }
  await writeMatchesToDb(db, matches);
  window.localStorage.removeItem(STORAGE_KEY);
}

function sortNewestFirst(a: ScorepadMatch, b: ScorepadMatch): number {
  return Date.parse(b.capturedAt) - Date.parse(a.capturedAt);
}

function openScorepadDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: "localId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readMatchesFromDb(db: IDBDatabase): Promise<ScorepadMatch[]> {
  return new Promise((resolve) => {
    const transaction = db.transaction(DB_STORE, "readonly");
    const request = transaction.objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as ScorepadMatch[] : []);
    request.onerror = () => resolve([]);
  });
}

function writeMatchesToDb(db: IDBDatabase, matches: ScorepadMatch[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    const store = transaction.objectStore(DB_STORE);
    store.clear();
    matches.forEach((match) => store.put(match));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function registerScorepadServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const register = () => navigator.serviceWorker.register("/scorepad-sw.js").catch(() => undefined);
  if (document.readyState === "complete") {
    void register();
    return;
  }
  window.addEventListener("load", () => void register(), { once: true });
}
