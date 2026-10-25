import { normalizeReplayProviderCapture } from "@/lib/replay-v2/provider-normalization";
import { sanitizeCanonicalReplay } from "@/lib/replay-v2-server/projection";
import { decodeAtlasPostgameReplay, encodeAtlasPostgameReplay, matchAtlasPostgameReplay } from "@/lib/replay-v2/atlas-postgame";
import type { JsonObject } from "@/lib/replay-v2/types";

/** Entirely synthetic player fixture, using production normalization and privacy projection. */
export function atlasPostgamePlayerFixture(withHousekeeping = false) {
  return buildFixture(withHousekeeping, false, false);
}

/** Unknown returned cards deliberately never appear in this post-game source. */
export function atlasPostgameMulliganFixture(legacyMetadata = false) {
  return buildFixture(false, true, legacyMetadata);
}

function buildFixture(withHousekeeping: boolean, withMulligan: boolean, legacyMetadata: boolean) {
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
  if (withMulligan) {
    const handCard = (id: string, name: string, cardCode: string) => ({ id, name, cardCode, ownerPlayerId: "b", exhausted: false });
    players[0].board.hand = Array.from({ length: 4 }, (_, index) => ({ ...players[0].board.hand[0], id: `a-kept-${index}` }));
    players[1].board.hand = [
      handCard("b-kept-1", "Daring Poro", "OGN-135"),
      handCard("b-kept-2", "Eager Apprentice", "OGN-031"),
      handCard("b-refill-1", "Harnessed Dragon", "OGN-015"),
      handCard("b-refill-2", "Black Rose Dignitary", "UNL-152"),
      handCard("b-opening", "Eager Drakehound", "SFD-006"),
    ];
    state.firstPlayerId = "b";
    state.activeTurnPlayerId = "b";
    if (!legacyMetadata) state.mulliganPlaybackByPlayerId = {
      a: { redrawCount: 0, draws: [], hiddenRefillCardIds: [], hiddenRuneCardIds: [] },
      b: { redrawCount: 2, draws: [
        { id: "refill-1", cardId: "b-refill-1", kind: "refill", handCountBeforeDraw: 2 },
        { id: "refill-2", cardId: "b-refill-2", kind: "refill", handCountBeforeDraw: 3 },
        { id: "opening-1", cardId: "b-opening", kind: "opening", handCountBeforeDraw: 4 },
      ], hiddenRefillCardIds: [], hiddenRuneCardIds: [] },
    };
  }
  const frames = [
    { index: 0, sequence: 10, elapsedMs: 0, actionType: withMulligan ? "game_start" : "start", state },
    { index: 1, sequence: 11, elapsedMs: 30_000, actionType: "concede", state: { ...state, turnNumber: 2,
      gameHistoryEndedAt: start + 30_000, gameOutcome: { winnerPlayerIds: ["a"], reason: "concession" } } },
  ];
  const source = decodeAtlasPostgameReplay({ format: "riftatlas-replay", version: 1, replay: {
    replayId: "synthetic-ui-export", viewerPlayerId: "a", players: players.map(({ id, name }) => ({ id, name })),
    canFork: true, canSwitchPerspective: true, createdAt: start, completedAt: start + 30_000, frames,
  } });
  const openingState = structuredClone(state);
  openingState.phase = "mulligan";
  if (withMulligan) {
    delete openingState.mulliganPlaybackByPlayerId;
    // Only the live hand count is known here; these are never reused as post-game identities.
    const opponent = (openingState.players as JsonObject[])[1];
    (opponent.board as JsonObject).hand = [{}, {}, {}, {}];
  }
  const captureFrames = [{ sequence: withMulligan ? 8 : 9, elapsedMs: -10_000, state: openingState }, ...frames];
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
    if (withMulligan && snapshot.mulliganPlaybackByPlayerId) {
      const playback = (snapshot.mulliganPlaybackByPlayerId as JsonObject).b as JsonObject;
      playback.draws = (playback.draws as JsonObject[]).map((draw, index) => ({ ...draw, cardId: `__hidden_zone__:b:hand:${index + 2}` }));
    }
    return { ts: start + frame.elapsedMs, dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", gameInstanceId: "UIMASK", viewerPlayerId: "a", sequence: frame.sequence, snapshot,
    }) };
  });
  if (withMulligan) messages.splice(1, 0, { ts: start - 5_000, dir: "in", raw: JSON.stringify({
    type: "authoritative_patch_commit", gameInstanceId: "UIMASK", sequence: 9, baseSequence: 8,
    action: { type: "submit_mulligan" },
    patch: { operations: [{ op: "set_board_fields", playerId: "b", fields: { recycledDeckBottomCount: 2 } }] },
  }) });
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
