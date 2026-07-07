export type RawReplayMessage = {
  seq?: number;
  ts?: number;
  dir?: "in" | "out" | string;
  raw?: string;
  parsed?: unknown;
  data?: unknown;
};

export type ReplayCard = {
  id: string;
  name: string;
  imageUrl?: string;
  type?: string;
  ownerId?: string;
  code?: string;
};

export type ReplayZone = {
  id: string;
  name: string;
  visibility: "public" | "private" | "hidden";
  hidden: number;
  cards: ReplayCard[];
};

export type ReplayPlayer = {
  id: string;
  name: string;
  role?: string;
  seat?: number | string;
  score?: number;
  legend?: ReplayCard;
  battlefield?: ReplayCard;
  selectedBattlefieldName?: string;
  battlefieldOptions?: ReplayCard[];
  zones: ReplayZone[];
};

export type ReplayRoomState = {
  phase?: string;
  firstPlayerId?: string;
  activeTurnPlayerId?: string;
  initiativeRolls?: Record<string, number>;
  mulliganPlaybackByPlayerId?: Record<string, unknown>;
};

export type ReplayTimelineEvent = {
  id: string;
  index: number;
  ts?: number;
  iso?: string;
  type: string;
  label: string;
  detail?: string;
  packetType?: string;
  playerId?: string;
  playerName?: string;
  cardName?: string;
  zone?: string;
  raw?: unknown;
};

export type ReplayFrame = {
  id: string;
  index: number;
  eventId: string;
  ts?: number;
  iso?: string;
  label: string;
  packetType: string;
  players: ReplayPlayer[];
  roomState?: ReplayRoomState;
};

export type ReplayDiagnostic = {
  id: string;
  severity: "info" | "warn" | "error";
  message: string;
  context?: string;
};

export type RiftReplayViewModel = {
  title: string;
  source: "raw-capture" | "custom-replay" | "unknown";
  roomCode?: string;
  captureSessionId?: string;
  startedAt?: number;
  endedAt?: number;
  lastPhase?: string;
  lastGameNumber?: number;
  matchFormat?: string;
  messageCount: number;
  players: ReplayPlayer[];
  timeline: ReplayTimelineEvent[];
  frames: ReplayFrame[];
  roomState?: ReplayRoomState;
  diagnostics: ReplayDiagnostic[];
  packetCounts: Record<string, number>;
};
