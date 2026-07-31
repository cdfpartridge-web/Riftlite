export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type RawReplayDirection = "in" | "out" | "unknown";

export type RawCaptureMessageV1 = {
  seq?: number;
  ts?: number;
  dir?: string;
  raw?: string;
  parsed?: unknown;
  data?: unknown;
};

export type RawCaptureMatchResultV1 = "win" | "loss" | "draw" | "incomplete";

export type RawCaptureMatchGameV1 = {
  gameNumber: number;
  result: RawCaptureMatchResultV1;
  perspectivePoints?: number;
  opponentPoints?: number;
};

export type RawCaptureMatchV1 = {
  format: "bo1" | "bo3";
  result: RawCaptureMatchResultV1;
  score: {
    perspective: number;
    opponent: number;
  };
  games: RawCaptureMatchGameV1[];
};

export type RawCaptureV1 = {
  schema: "riftreplay-raw-capture";
  version: 1;
  capture?: {
    captureSessionId?: string;
    identity?: Record<string, unknown>;
    lifecycle?: Record<string, unknown>;
    match?: RawCaptureMatchV1;
  };
  messages: RawCaptureMessageV1[];
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ParsedReplayPacket = {
  id: string;
  order: number;
  sourceIndex: number;
  seq: number;
  at: number;
  atMs: number;
  direction: RawReplayDirection;
  packetType: string;
  payload: JsonObject | null;
  raw: string;
  parseError?: string;
};

export type ParsedRawCapture = {
  captureId: string;
  roomCode: string;
  seriesIdentity: string;
  startedAt: number;
  endedAt: number;
  packets: ParsedReplayPacket[];
  diagnostics: ReplayDiagnostic[];
  source: RawCaptureV1;
};

export type ReplaySeriesFormat = "bo1" | "bo3" | "unknown";

export type ReplayPhase =
  | "lobby"
  | "matchup"
  | "sideboarding"
  | "battlefield_pick"
  | "initiative_roll"
  | "first_player_choice"
  | "mulligan"
  | "in_game"
  | "game_end"
  | "series_end"
  | "unknown";

export type ReplayParticipant = {
  id: string;
  name: string;
  isPerspective: boolean;
  seat?: number | string;
  role?: string;
  fields: JsonObject;
};

export type ReplayPhaseSegment = {
  phase: ReplayPhase;
  rawPhase: string;
  startEventIndex: number;
  endEventIndex: number;
  startedAtMs: number;
  endedAtMs: number;
};

export type ReplayGameResult = {
  resultEventId: string;
  winnerPlayerId?: string;
  loserPlayerId?: string;
  finalScores?: Record<string, number>;
};

export type ReplayGame = {
  id: string;
  ordinal: number;
  gameNumber: number;
  sourceIdentity: {
    explicitGameNumber: boolean;
    gameInstanceIds: string[];
    resultEventId?: string;
  };
  startedAt: number;
  endedAt: number;
  startedAtMs: number;
  endedAtMs: number;
  eventStartIndex: number;
  eventEndIndex: number;
  phases: ReplayPhaseSegment[];
  result?: ReplayGameResult;
};

export type ReplaySeriesResult = {
  resultEventId: string;
  source: "desktop_match_metadata";
  outcome: "win" | "loss" | "draw";
  winnerPlayerId?: string;
  loserPlayerId?: string;
  finalScores: Record<string, number>;
};

export type ReplaySeries = {
  id: string;
  perspectivePlayerId?: string;
  format: ReplaySeriesFormat;
  bestOf: 1 | 3 | null;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  participants: ReplayParticipant[];
  games: ReplayGame[];
  result?: ReplaySeriesResult;
};

export type ReplayCardState = {
  id: string;
  name: string;
  cardCode?: string;
  ownerPlayerId?: string;
  source?: string;
  exhausted?: boolean;
  isPlaceholder?: boolean;
  fields: JsonObject;
};

export type ReplayPlayerState = {
  id: string;
  name: string;
  seat?: number | string;
  score?: number;
  fields: JsonObject;
  boardFields: JsonObject;
  zones: Record<string, ReplayCardState[]>;
};

export type ReplayChainEntry = {
  id: string;
  fields: JsonObject;
};

export type ReplayLogEntry = {
  id: string;
  at?: number;
  text: string;
  authorPlayerId?: string;
  fields: JsonObject;
};

export type ReplayChatEntry = {
  id: string;
  at?: number;
  author: string;
  authorPlayerId?: string;
  text: string;
  fields: JsonObject;
};

export type ReplayRoomState = {
  phase: ReplayPhase;
  rawPhase: string;
  gameNumber: number;
  activeTurnPlayerId?: string;
  firstPlayerId?: string;
  turnNumber?: number;
  fields: JsonObject;
};

export type ReplaySnapshot = {
  room: ReplayRoomState;
  players: Record<string, ReplayPlayerState>;
  chain: ReplayChainEntry[];
  log: ReplayLogEntry[];
};

export type ReplayState = ReplaySnapshot & {
  seriesId: string;
  gameId: string | null;
  gameOrdinal: number | null;
  phase: ReplayPhase;
  chat: ReplayChatEntry[];
  appliedEventIndex: number;
};

type ReplayEventBase = {
  id: string;
  index: number;
  at: number;
  atMs: number;
  sourceMessageId: string;
  gameId: string | null;
};

export type ReplayGameBoundaryEvent = ReplayEventBase & {
  kind: "game_boundary";
  boundary: "start" | "end";
  gameOrdinal: number;
  gameNumber: number;
  reason: "series_start" | "explicit_game_number" | "explicit_result" | "terminal_score" | "phase_rollover" | "capture_end";
};

export type ReplayPhaseEvent = ReplayEventBase & {
  kind: "phase";
  phase: ReplayPhase;
  rawPhase: string;
  gameNumber: number;
};

export type ReplaySnapshotEvent = ReplayEventBase & {
  kind: "snapshot";
  sequence?: number;
  snapshot: ReplaySnapshot;
};

export type ReplayPatchOperation =
  | {
      id: string;
      op: "zone_insert";
      playerId: string;
      zone: string;
      index: number;
      cards: ReplayCardState[];
    }
  | {
      id: string;
      op: "zone_remove";
      playerId: string;
      zone: string;
      cardIds: string[];
    }
  | {
      id: string;
      op: "zone_move";
      cardId: string;
      from: { playerId: string; zone: string };
      to: { playerId: string; zone: string; index: number };
      card?: ReplayCardState;
    }
  | {
      id: string;
      op: "patch_card_fields";
      playerId: string;
      zone: string;
      cardId: string;
      fields: JsonObject;
    }
  | {
      id: string;
      op: "unset_card_fields";
      playerId: string;
      zone: string;
      cardId: string;
      fields: string[];
    }
  | {
      id: string;
      op: "set_room_fields";
      fields: JsonObject;
    }
  | {
      id: string;
      op: "unset_room_fields";
      fields: string[];
    }
  | {
      id: string;
      op: "set_player_fields";
      playerId: string;
      fields: JsonObject;
    }
  | {
      id: string;
      op: "set_board_fields";
      playerId: string;
      fields: JsonObject;
    }
  | {
      id: string;
      op: "chain_insert";
      index: number;
      entries: ReplayChainEntry[];
    }
  | {
      id: string;
      op: "chain_remove";
      entryIds: string[];
    }
  | {
      id: string;
      op: "log_insert";
      index: number;
      entries: ReplayLogEntry[];
    }
  | {
      id: string;
      op: "log_remove";
      entryIds: string[];
    }
  | {
      id: string;
      op: "unknown";
      sourceOp: string;
      payload: JsonObject;
    };

export type ReplayActionConfirmation = {
  status: "confirmed";
  authority: "authoritative_patch_commit";
  correlation: "matched_intent" | "intent_not_observed";
  clientActionId?: string;
  intentMessageId?: string;
  commitMessageId: string;
  latencyMs?: number;
};

export type ReplayActionEvent = ReplayEventBase & {
  kind: "action";
  actionType: string;
  actorPlayerId?: string;
  action: JsonObject;
  confirmation: ReplayActionConfirmation;
  patch: {
    baseSequence?: number;
    sequence?: number;
    operations: ReplayPatchOperation[];
  };
};

export type ReplayChatEvent = ReplayEventBase & {
  kind: "chat";
  mode: "append" | "replace";
  entries: ReplayChatEntry[];
};

export type ReplayLogEvent = ReplayEventBase & {
  kind: "log";
  mode: "append" | "replace";
  entries: ReplayLogEntry[];
};

export type ReplayInteractionEvent = ReplayEventBase & {
  kind: "interaction";
  interactionType: "card_ping" | "board_emote";
  actorPlayerId?: string;
  cardId?: string;
  emoteId?: string;
  payload: JsonObject;
};

export type ReplayUnknownEvent = ReplayEventBase & {
  kind: "unknown";
  packetType: string;
  reason: "unsupported_packet" | "malformed_packet" | "unknown_patch_operation" | "unconfirmed_intent";
  payload: JsonValue;
};

export type ReplayEvent =
  | ReplayGameBoundaryEvent
  | ReplayPhaseEvent
  | ReplaySnapshotEvent
  | ReplayActionEvent
  | ReplayChatEvent
  | ReplayLogEvent
  | ReplayInteractionEvent
  | ReplayUnknownEvent;

export type ReplayDiagnostic = {
  id: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  sourceMessageId?: string;
  eventId?: string;
};

export type ReplayCheckpoint = {
  id: string;
  eventIndex: number;
  atMs: number;
  stateHash: string;
  state: ReplayState;
};

export type ReplayCollaborationDiagnostics = {
  primarySourceReplayId: string;
  pairedSnapshotEvents: number;
  pairedActionEvents: number;
  unpairedPrimaryEvents: number;
  unpairedSecondaryEvents: number;
  enrichedCards: number;
  enrichedFields: number;
  coveragePercent: number;
  warningCodes: string[];
};

export type ReplayCollaboration = {
  schema: "riftlite-dual-perspective";
  version: 1;
  mode: "dual-perspective";
  sourceReplayIds: [string, string];
  sourceCanonicalSha256s: [string, string];
  perspectivePlayerIds: [string, string];
  informationPolicy: "consented_full_information";
  confidence: "exact" | "strong" | "review";
  diagnostics: ReplayCollaborationDiagnostics;
};

export type CanonicalReplayV2 = {
  schema: "riftlite-canonical-replay";
  version: 2;
  id: string;
  source: {
    schema: "riftreplay-raw-capture" | "riftlite-tcga-raw-capture";
    version: 1;
    captureSessionId: string;
    roomCode: string;
    startedAt: number;
    endedAt: number;
    messageCount: number;
  };
  series: ReplaySeries;
  events: ReplayEvent[];
  unknownEvents: ReplayUnknownEvent[];
  diagnostics: ReplayDiagnostic[];
  checkpoints: ReplayCheckpoint[];
  collaboration?: ReplayCollaboration;
};

export type ReplaySeekResult = {
  targetMs: number;
  eventIndex: number;
  checkpointEventIndex: number;
  state: ReplayState;
};
