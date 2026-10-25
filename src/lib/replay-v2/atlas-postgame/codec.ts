import { isRecord, redactSecrets } from "../json";
import type { JsonObject, JsonValue } from "../types";
import { ATLAS_POSTGAME_LIMITS as LIMITS, AtlasPostgameError, type AtlasPostgameEnvelopeV2, type AtlasPostgameSource } from "./types";
import { sanitizeAtlasMulliganPlayback, validateAtlasPostgameView } from "./validation";

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const fail = (message: string): never => { throw new AtlasPostgameError(message); };
const primitive = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
const allowed = (words: string) => new Set(words.split(" "));
const KEYS: Record<string, Set<string>> = {
  view: allowed("replayId viewerPlayerId players canFork forkBlockedReason privateDeckPlayerIds canSwitchPerspective canExtend createdAt completedAt expiresAt frames"),
  metaPlayer: allowed("id name seat"),
  frame: allowed("index sequence elapsedMs actionType actorPlayerId turnNumber activePlayerId state"),
  state: allowed("roomCode createdAt updatedAt phase rewindProtocolVersion testMode gameVariant roomMode teamIdByPlayerId playMode deckRulesMode matchFormat gameNumber seriesStartedAt winsByPlayerId gameHistoryStartedAt gameHistoryEndedAt firstPlayerId activeTurnPlayerId activeTurnStep turnNumber playerTurnCounts players log chainEntries chainResolveVotes gameOutcome bo3CompletedGames targetArrowsByPlayer mulliganPlaybackByPlayerId"),
  mulligan: allowed("redrawCount draws"),
  mulliganDraw: allowed("id cardId handCountBeforeDraw kind"),
  player: allowed("id seat name joinedAt leftAt leftReason selectedBattlefield board"),
  board: allowed("score floatingEnergy floatingPower legendXp deck hand base trash discard banished battlefieldA battlefieldB battlefieldC battlefieldToken champion legend additionalLegends runeDeck runeArea sideboard removed recycledDeckBottomCount handRevealToOpponent handRevealedToPlayerIds deckPeek"),
  card: allowed("id name source exhausted createdAt ownerPlayerId isDuplicate hidden revealedToPlayerIds revealedToOpponent oriannaAnimation neekoSourceCardId attachedToCardId banishedByCardId banishedUntilEndingPlayerId empowerTriggerUsed cardCode hasWhenYouPlayMe type domains text energyCost powerCost might temporaryMightBuff whiteCounter redCounter customLabels rarity set keywords subtypes isPlaceholder"),
  chain: allowed("id card addedAt fromZone sourceCardId byPlayerId byPlayerName repeatEnabled flowEnabled passesShowdownFocusOnResolution"),
  log: allowed("id at text authorPlayerId turnNumber turnPlayerId actionKind"),
  outcome: allowed("winnerPlayerIds reason decidedAtTurnNumber"),
  peek: allowed("zone cardIds revealedCardIds autoRevealNewCards revision"),
  arrow: allowed("sourceCardId targetCardId sourceAnchor targetAnchor"),
  animation: allowed("legendId type might whiteCounter"),
  completedGame: allowed("gameNumber scoresByPlayerId actionClockMsByPlayerId durationMs"),
};
function childKind(kind: string, key: string): string {
  if (kind.endsWith("[]")) return kind.slice(0, -2);
  if (kind === "view" && key === "players") return "metaPlayer[]";
  if (kind === "view" && key === "frames") return "frame[]";
  if (kind === "frame" && key === "state") return "state";
  if (kind === "state" && key === "players") return "player[]";
  if (kind === "state" && key === "chainEntries") return "chain[]";
  if (kind === "state" && key === "log") return "log[]";
  if (kind === "state" && key === "gameOutcome") return "outcome";
  if (kind === "state" && key === "targetArrowsByPlayer") return "arrowMap";
  if (kind === "state" && key === "mulliganPlaybackByPlayerId") return "mulliganMap";
  if (kind === "mulliganMap") return "mulligan";
  if (kind === "mulligan" && key === "draws") return "mulliganDraw[]";
  if (kind === "arrowMap") return "arrow[]";
  if (kind === "state" && ["teamIdByPlayerId", "winsByPlayerId", "playerTurnCounts"].includes(key)) return "scalarMap";
  if (kind === "state" && key === "bo3CompletedGames") return "completedGame[]";
  if (kind === "completedGame" && ["scoresByPlayerId", "actionClockMsByPlayerId"].includes(key)) return "scalarMap";
  if (kind === "card" && key === "oriannaAnimation") return "animation";
  if (kind === "player" && key === "board") return "board";
  if (kind === "player" && key === "selectedBattlefield" || kind === "chain" && key === "card") return "card";
  if (kind === "board" && key === "deckPeek") return "peek";
  if (kind === "board" && !["score", "floatingEnergy", "floatingPower", "legendXp", "recycledDeckBottomCount", "handRevealToOpponent", "handRevealedToPlayerIds"].includes(key)) return "card[]";
  return "json";
}

/** Decode the backward-reference format without expanding shared states or evaluating file content. */
function decodeNodes(envelope: Record<string, unknown>): JsonObject {
  if (!Array.isArray(envelope.nodes) || !envelope.nodes.length || envelope.nodes.length > LIMITS.maxNodes) return fail("The Atlas replay has too many nodes or no data.");
  const decoded: JsonValue[] = [], depths: number[] = [], costs: number[] = [];
  let entries = 0, encodedBytes = 0;
  for (const [index, node] of envelope.nodes.entries()) {
    if (!Array.isArray(node) || node.length !== 2 || !["a", "o"].includes(node[0]) || !Array.isArray(node[1])) return fail("Invalid Atlas replay node.");
    entries += node[1].length;
    if (entries > LIMITS.maxEntries) return fail("The Atlas replay has too many entries.");
    let depth = 1, cost = 2 + Math.max(0, node[1].length - 1);
    const read = (value: unknown): JsonValue => {
      if (primitive(value)) { const size = bytes(value); cost += size; encodedBytes += size; return value; }
      if (!isRecord(value) || Object.keys(value).length !== 1 || !Number.isSafeInteger(value.r) || (value.r as number) < 0 || (value.r as number) >= index) return fail("Invalid Atlas replay reference.");
      const ref = value.r as number;
      depth = Math.max(depth, depths[ref] + 1); cost += costs[ref]; encodedBytes += 16;
      return decoded[ref];
    };
    let value: JsonValue;
    if (node[0] === "a") value = node[1].map(read);
    else {
      const object: JsonObject = Object.create(null);
      for (const entry of node[1]) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || entry[0].length > 512 || FORBIDDEN.has(entry[0]) || Object.hasOwn(object, entry[0])) return fail("Invalid Atlas replay property.");
        const size = bytes(entry[0]) + 1; cost += size; encodedBytes += size;
        object[entry[0]] = read(entry[1]);
      }
      value = object;
    }
    if (depth > LIMITS.maxDepth || cost > LIMITS.maxExpandedBytes || encodedBytes > LIMITS.maxInputBytes) return fail("The Atlas replay exceeds the safe import limits.");
    decoded.push(value); depths.push(depth); costs.push(cost);
  }
  const root = envelope.root;
  if (!isRecord(root) || Object.keys(root).length !== 1 || root.r !== decoded.length - 1 || !isRecord(decoded[root.r as number])) return fail("Invalid Atlas replay root.");
  return decoded[root.r as number] as JsonObject;
}

/** Sanitize once per distinct object, preserving shared references; never stringify the expanded replay. */
function sanitizeGraph(input: unknown): JsonObject {
  const memo = new WeakMap<object, Map<string, { value: JsonValue; cost: number; depth: number }>>();
  const active = new WeakSet<object>();
  const safeKeys = new Map<string, boolean>();
  const mulliganMemo = new WeakMap<object, JsonObject | null>();
  let entries = 0, nodes = 0, encodedBytes = 0;
  const visit = (value: unknown, level: number, kind: string): { value: JsonValue; cost: number; depth: number } => {
    if (level > LIMITS.maxDepth) return fail("The Atlas replay is nested too deeply.");
    if (primitive(value)) { const cost = bytes(value); encodedBytes += cost; if (encodedBytes > LIMITS.maxInputBytes) return fail("The Atlas replay is too large."); return { value, cost, depth: 0 }; }
    if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return fail("The Atlas replay is not JSON data.");
    if (kind === "json" && !Array.isArray(value)) return fail("The Atlas replay contains unexpected nested data.");
    if (active.has(value)) return fail("The Atlas replay contains a circular reference.");
    const seen = memo.get(value)?.get(kind); if (seen) return seen;
    if (++nodes > LIMITS.maxNodes) return fail("The Atlas replay has too many nodes.");
    active.add(value);
    const output: JsonValue[] | JsonObject = Array.isArray(value) ? [] : Object.create(null);
    let cost = 2, depth = 1;
    for (const [key, rawChild] of Object.entries(value)) {
      let child = rawChild;
      if (++entries > LIMITS.maxEntries) return fail("The Atlas replay has too many entries.");
      if (FORBIDDEN.has(key) || key.length > 512) return fail("Invalid Atlas replay property.");
      if (!Array.isArray(value)) {
        if (KEYS[kind] && !KEYS[kind].has(key)) continue;
        if (kind === "state" && key === "mulliganPlaybackByPlayerId") {
          if (!child || typeof child !== "object") continue;
          if (!mulliganMemo.has(child)) {
            const players = (value as Record<string, unknown>).players;
            const ids = Array.isArray(players) ? players.map(player => isRecord(player) && typeof player.id === "string" ? player.id : "") : [];
            mulliganMemo.set(child, sanitizeAtlasMulliganPlayback(child, ids));
          }
          const optional = mulliganMemo.get(child);
          if (!optional) continue;
          child = optional;
        }
        let safe = safeKeys.get(key);
        if (safe === undefined) { safe = Object.hasOwn(redactSecrets({ [key]: null }) as object, key); safeKeys.set(key, safe); }
        if (!safe) continue;
        const size = bytes(key) + 1; cost += size; encodedBytes += size;
      }
      const result = visit(child, level + 1, childKind(kind, key));
      if (Array.isArray(output)) output.push(result.value); else output[key] = result.value;
      cost += result.cost + 1; depth = Math.max(depth, result.depth + 1);
      if (cost > LIMITS.maxExpandedBytes || depth > LIMITS.maxDepth || encodedBytes > LIMITS.maxInputBytes) return fail("The Atlas replay exceeds the safe import limits.");
    }
    active.delete(value);
    const result = { value: output, cost, depth };
    const kinds = memo.get(value) ?? new Map(); kinds.set(kind, result); memo.set(value, kinds); return result;
  };
  const result = visit(input, 0, "view").value;
  if (!isRecord(result)) return fail("Invalid Atlas replay data.");
  return result as JsonObject;
}

export function decodeAtlasPostgameReplay(input: string | unknown): AtlasPostgameSource {
  let envelope: unknown = input;
  if (typeof input === "string") {
    if (encoder.encode(input).length > LIMITS.maxInputBytes) return fail("The Atlas replay file is too large (16 MB maximum).");
    try { envelope = JSON.parse(input); } catch { return fail("This file is not valid JSON."); }
  }
  if (!isRecord(envelope) || envelope.format !== "riftatlas-replay" || ![1, 2].includes(envelope.version as number)) return fail("Choose an Atlas replay export (version 1 or 2).");
  const raw = envelope.version === 2 ? decodeNodes(envelope) : envelope.replay;
  return validateAtlasPostgameView(sanitizeGraph(raw));
}

/** Re-encode only the sanitized graph. Shared states become references, never repeated JSON trees. */
export function encodeAtlasPostgameReplay(source: AtlasPostgameSource): AtlasPostgameEnvelopeV2 {
  const nodes: AtlasPostgameEnvelopeV2["nodes"] = [];
  const memo = new WeakMap<object, number>();
  type Value = AtlasPostgameEnvelopeV2["root"] | string | number | boolean | null;
  const write = (value: JsonValue): Value => {
    if (primitive(value)) return value;
    const seen = memo.get(value); if (seen !== undefined) return { r: seen };
    const node: AtlasPostgameEnvelopeV2["nodes"][number] = Array.isArray(value)
      ? ["a", value.map(write)] : ["o", Object.entries(value).map(([key, child]): [string, Value] => [key, write(child)])];
    const index = nodes.length; nodes.push(node); memo.set(value, index); return { r: index };
  };
  const root = write(source.view) as { r: number };
  return { format: "riftatlas-replay", version: 2, nodes, root };
}
