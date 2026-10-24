import { normalizeReplayProviderCapture } from "@/lib/replay-v2/provider-normalization";
import { sanitizeCanonicalReplay } from "@/lib/replay-v2-server/projection";
import { decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay } from "@/lib/replay-v2/atlas-postgame";
import type { JsonObject } from "@/lib/replay-v2/types";

/** Entirely synthetic player fixture, using production normalization and privacy projection. */
export function atlasPostgamePlayerFixture(withHousekeeping = false) {
  const start = 1_790_000_000_000, replayId = "rl2_" + "a".repeat(32);
  const players = ["a", "b"].map(id => {
    const card = (zone: string, name: string, cardCode: string) => ({ id: `${id}-${zone}`, name, cardCode, ownerPlayerId: id, exhausted: false });
    return { id, name: id === "a" ? "Player Alpha" : "Player Beta", board: {
      score: 0, floatingEnergy: 0, floatingPower: 0,
      hand: [card("hand", id === "a" ? "Harnessed Dragon" : "Daring Poro", id === "a" ? "OGN-015" : "OGN-135")],
      deck: [card("deck", "Daring Poro", "OGN-135")], runeDeck: [],
      legend: [card("legend", id === "a" ? "Ahri" : "Jinx", id === "a" ? "OGN-001" : "OGN-003")],
      base: [], trash: [], battlefieldA: [], battlefieldB: [], champion: [], runeArea: [], handRevealToOpponent: false,
    } };
  });
  const state: JsonObject = { roomCode: "UIMASK", createdAt: start - 20_000, gameHistoryStartedAt: start,
    phase: "in_game", gameVariant: "duel", roomMode: "multiplayer", matchFormat: "bo1", gameNumber: 1,
    rewindProtocolVersion: 5, testMode: false, activeTurnPlayerId: "a", turnNumber: 1, firstPlayerId: "a",
    players, chainEntries: [], log: [], targetArrowsByPlayer: {} };
  const frames = [
    { index: 0, sequence: 10, elapsedMs: 0, actionType: "start", state },
    { index: 1, sequence: 11, elapsedMs: 30_000, actionType: "concede", state: { ...state, turnNumber: 2,
      gameHistoryEndedAt: start + 30_000, gameOutcome: { winnerPlayerIds: ["a"], reason: "concession" } } },
  ];
  const source = decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 1, replay: {
    replayId: "synthetic-ui-export", viewerPlayerId: "a", players: players.map(({ id, name }) => ({ id, name })),
    canFork: true, canSwitchPerspective: true, createdAt: start, completedAt: start + 30_000, frames,
  } });
  const captureFrames = [{ sequence: 9, elapsedMs: -10_000, state: { ...state, phase: "mulligan" } }, ...frames];
  const messages = captureFrames.map(frame => {
    const snapshot = structuredClone(frame.state) as JsonObject;
    for (const player of snapshot.players as JsonObject[]) {
      const board = player.board as JsonObject;
      for (const zone of ["deck", "runeDeck", ...(player.id === "b" ? ["hand"] : [])]) {
        board[zone] = (board[zone] as JsonObject[]).map((_card, index) => ({
          id: `__hidden_zone__:${player.id}:${zone}:${index}`, name: "", isPlaceholder: true,
          source: "mainDeck", exhausted: false, createdAt: 0,
        }));
      }
    }
    return { ts: start + frame.elapsedMs, dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", gameInstanceId: "UIMASK", viewerPlayerId: "a", sequence: frame.sequence, snapshot,
    }) };
  });
  if (withHousekeeping) messages.splice(2, 0, { ts: start + 4_000, dir: "in", raw: JSON.stringify({
    type: "rewind_confirmation_state", gameInstanceId: "UIMASK", confirmation: null,
  }) });
  const raw = { schema: "riftreplay-raw-capture", version: 1,
    capture: { captureSessionId: "fixture-ui-capture-session", identity: { firstSeenAt: start - 10_000, lastSeenAt: start + 30_000 } },
    messages: messages.map((message, seq) => ({ ...message, seq })),
  };
  const canonical = sanitizeCanonicalReplay(normalizeReplayProviderCapture(raw, "atlas", replayId).replay);
  const alignment = matchAtlasPostgameReplay(canonical, source);
  const game = { gameId: alignment.gameId, gameNumber: 1, frameCount: frames.length, sha256: "f".repeat(64), shared: false,
    firstElapsedMs: 0, lastElapsedMs: 30_000, matchedEventCount: alignment.matchedEventCount };
  const metadata = { accountId: "fixture-owner", canManage: true, available: true, shared: false, games: [game] };
  return { replayId, raw, canonical, source, alignment, metadata,
    supplement: { ...metadata, exports: [{ gameId: alignment.gameId, replay: encodeAtlasPostgameReplay(source) }] } };
}
