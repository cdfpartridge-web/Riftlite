import "server-only";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash, randomInt } from "node:crypto";
import { getFirestoreAdmin } from "@/lib/firebase/admin";
import { readImmutableArtifact } from "@/lib/replay-v2-server/artifacts";
import {
  REPLAY_COLLECTION,
  MAX_CANONICAL_JSON_BYTES,
} from "@/lib/replay-v2-server/constants";
import { configuredReplayEmbedSecret } from "@/lib/replay-v2-server/session";
import type { ReplayArtifactPointer } from "@/lib/replay-v2-server/model";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
import type { CanonicalReplayV2 } from "@/lib/replay-v2";
import registry from "@/lib/mulligan-lab/card-registry-v1.json";
import {
  anonymousOpeningReplay,
  extractOpeningLines,
  isOpeningSource,
  recordedOpeningChanges,
  type OpeningLine,
} from "./domain";
import { openOpeningToken, sealOpeningToken, type OpeningToken } from "./token";
import type {
  OpeningCatalog,
  OpeningFilters,
  OpeningQuestion,
  OpeningReveal,
} from "./types";

type Source = {
  id: string;
  visibility: string;
  status: string;
  revision: string;
  legend: string;
  opponent: string;
  artifact?: ReplayArtifactPointer;
  fixturePath?: string;
};
type Loaded = {
  source: Source;
  replay: CanonicalReplayV2;
  lines: OpeningLine[];
};
const short = (s: string) => s.split(",")[0].trim().toLowerCase();
const legends = [
  ...new Set(
    Object.values(registry.cards)
      .filter((c) => c.type.toLowerCase() === "legend")
      .map((c) => c.name),
  ),
];
const validLegend = (s: unknown) =>
  typeof s === "string"
    ? (legends.find((name) => short(name) === short(s)) ?? "")
    : "";
let cached: { until: number; sources: Source[]; limited: boolean } | null =
  null;
const loaded = new Map<string, Loaded>();

export class OpeningLabError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function sourceFrom(id: string, data: Record<string, unknown>): Source | null {
  if (!isOpeningSource(data)) return null;
  const listing = data.listing as
    | { playerLegend?: string; opponentLegend?: string }
    | undefined;
  const artifact = data.canonicalArtifact as ReplayArtifactPointer | undefined;
  if (!artifact?.sha256) return null;
  return {
    id,
    visibility: String(data.visibility),
    status: String(data.status),
    revision: artifact.sha256,
    legend: validLegend(listing?.playerLegend),
    opponent: validLegend(listing?.opponentLegend),
    artifact,
  };
}

async function developmentSources(): Promise<Source[] | null> {
  const path =
    process.env.NODE_ENV !== "production"
      ? process.env.OPENING_LAB_FIXTURE_MANIFEST
      : undefined;
  if (!path) return null;
  const entries = JSON.parse(await readFile(path, "utf8")) as Array<{
    path: string;
    visibility: string;
  }>;
  const sources: Source[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!isOpeningSource({ visibility: entry.visibility, status: "ready" }))
      continue;
    const text = await readFile(entry.path, "utf8"),
      replay = JSON.parse(text) as CanonicalReplayV2;
    const lines = extractOpeningLines(replay);
    if (!lines.length) continue;
    const source: Source = {
      id: `local-${index}`,
      visibility: entry.visibility,
      status: "ready",
      revision: createHash("sha256").update(text).digest("hex"),
      legend: lines[0].legend,
      opponent: lines[0].opponent,
      fixturePath: entry.path,
    };
    sources.push(source);
    loaded.set(source.id, { source, replay, lines });
  }
  return sources;
}

async function sources(): Promise<{ sources: Source[]; limited: boolean }> {
  if (cached && cached.until > Date.now()) return cached;
  const fixtures = await developmentSources();
  if (fixtures) return { sources: fixtures, limited: false };
  const db = getFirestoreAdmin();
  if (!db)
    throw new OpeningLabError(
      "Opening practice is not available on this server yet.",
      503,
    );
  // One indexed visibility query; no new Firestore index or production writes.
  const docs = await db
    .collection(REPLAY_COLLECTION)
    .where("visibility", "in", ["public", "unlisted"])
    .limit(1500)
    .get();
  const values = docs.docs.flatMap((doc) => {
    const source = sourceFrom(doc.id, doc.data());
    return source ? [source] : [];
  });
  cached = {
    until: Date.now() + 120_000,
    sources: values,
    limited: docs.size === 1500,
  };
  return cached;
}

async function currentSource(id: string): Promise<Source> {
  const fixtures = await developmentSources();
  const source = fixtures
    ? fixtures.find((s) => s.id === id)
    : await (async () => {
        const db = getFirestoreAdmin();
        if (!db) return null;
        const doc = await db.collection(REPLAY_COLLECTION).doc(id).get();
        return doc.exists ? sourceFrom(doc.id, doc.data()!) : null;
      })();
  if (!source)
    throw new OpeningLabError(
      "This opening is no longer available. Choose another game.",
      410,
    );
  return source;
}

async function load(source: Source): Promise<Loaded> {
  const existing = loaded.get(source.id);
  if (existing?.source.revision === source.revision)
    return { ...existing, source };
  const db = getFirestoreAdmin();
  if (!db || !source.artifact)
    throw new OpeningLabError("This opening could not be loaded.", 503);
  const bytes = await readImmutableArtifact(db, source.artifact);
  const replay = JSON.parse(
    gunzipSync(bytes, { maxOutputLength: MAX_CANONICAL_JSON_BYTES }).toString(
      "utf8",
    ),
  ) as CanonicalReplayV2;
  if (replay.schema !== "riftlite-canonical-replay" || replay.version !== 2)
    throw new OpeningLabError("This opening format is unavailable.", 422);
  const result = { source, replay, lines: extractOpeningLines(replay) };
  // Bounded process cache, with fresh visibility/revision checks before every use.
  if (loaded.size >= 6) loaded.delete(loaded.keys().next().value!);
  loaded.set(source.id, result);
  return result;
}

function question(
  item: Loaded,
  line: OpeningLine,
  step: number,
  expires: number,
): OpeningQuestion {
  const token: OpeningToken = {
    replayId: item.source.id,
    revision: item.source.revision,
    gameId: line.gameId,
    step,
    expires,
  };
  return {
    token: sealOpeningToken(token, configuredReplayEmbedSecret()),
    turn: step + 1,
    totalTurns: 5,
    legend: line.legend,
    opponent: line.opponent,
    initiative: line.initiative,
    replay: anonymousOpeningReplay(
      item.replay,
      line,
      line.moments[step],
      false,
    ),
  };
}

export async function openingCatalog(): Promise<OpeningCatalog> {
  const corpus = await sources();
  return {
    legends: [
      ...new Set(corpus.sources.map((s) => s.legend).filter(Boolean)),
    ].sort(),
    opponents: [
      ...new Set(corpus.sources.map((s) => s.opponent).filter(Boolean)),
    ].sort(),
    scanned: corpus.sources.length,
    limited: corpus.limited,
  };
}

export async function startOpening(
  filters: OpeningFilters,
): Promise<OpeningQuestion> {
  try {
    configuredReplayEmbedSecret();
  } catch {
    throw new OpeningLabError(
      "Opening practice is not configured on this server yet.",
      503,
    );
  }
  const legend = validLegend(filters.legend),
    opponent = filters.opponent ? validLegend(filters.opponent) : "";
  if (!legend || (filters.opponent && !opponent))
    throw new OpeningLabError("Choose an available legend.");
  const candidates = (await sources()).sources.filter(
    (s) =>
      short(s.legend) === short(legend) &&
      (!opponent || short(s.opponent) === short(opponent)),
  );
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  let unavailable = 0;
  for (const candidate of candidates.slice(0, 20)) {
    try {
      const item = await load(await currentSource(candidate.id));
      const lines = item.lines.filter(
        (l) =>
          short(l.legend) === short(legend) &&
          (!opponent || short(l.opponent) === short(opponent)),
      );
      const line = lines.length ? lines[randomInt(lines.length)] : undefined;
      if (line) return question(item, line, 0, Date.now() + 2 * 60 * 60 * 1000);
    } catch (error) {
      if (!(error instanceof OpeningLabError) || error.status >= 500) {
        unavailable++;
        console.warn(
          "[opening-lab] Candidate unavailable:",
          error instanceof ReplayV2Error ? error.code : "source_unavailable",
        );
      }
    }
  }
  if (unavailable)
    throw new OpeningLabError(
      "Replay data could not be loaded. Please try again shortly.",
      503,
    );
  throw new OpeningLabError(
    "No complete five-turn opening was found for these filters in the checked replays. Try another matchup.",
    404,
  );
}

export async function revealOpening(token: string): Promise<OpeningReveal> {
  let value: OpeningToken;
  try {
    value = openOpeningToken(token, configuredReplayEmbedSecret());
  } catch {
    throw new OpeningLabError(
      "This practice session expired or changed. Start a new opening.",
      410,
    );
  }
  const item = await load(await currentSource(value.replayId));
  if (item.source.revision !== value.revision)
    throw new OpeningLabError("The source changed. Start a new opening.", 409);
  const line = item.lines.find((l) => l.gameId === value.gameId);
  if (!line)
    throw new OpeningLabError("This opening is no longer available.", 410);
  const replay = anonymousOpeningReplay(
    item.replay,
    line,
    line.moments[value.step],
    true,
  );
  return {
    replay,
    changes: recordedOpeningChanges(replay),
    next:
      value.step < 4
        ? question(item, line, value.step + 1, value.expires)
        : null,
  };
}
