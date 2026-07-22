import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildReplayCheckpoints } from "@/lib/replay-v2/checkpoints";
import type { TcgaReplayRawCaptureV1 } from "@/lib/replay-v2/tcga";
import type { CanonicalReplayV2, ReplayState } from "@/lib/replay-v2/types";
import {
  defaultFixtureIdForInput,
  readLocalTcgaRawCaptureFile,
  verifyLocalTcgaPreviewReplay,
} from "@/lib/tcga-local-preview-builder";

describe("local TCGA preview builder", () => {
  it("accepts a publication-quality TCGA canonical replay with masked opponent private zones", () => {
    expect(() => verifyLocalTcgaPreviewReplay(rawFixture(), canonicalFixture())).not.toThrow();
  });

  it("rejects raw player identifiers copied into the served canonical artifact", () => {
    const replay = canonicalFixture();
    replay.diagnostics.push({
      id: "diag-leak",
      severity: "warning",
      code: "unsafe",
      message: "raw-perspective-player-id",
    });

    expect(() => verifyLocalTcgaPreviewReplay(rawFixture(), replay)).toThrow(/raw_player_identifier/i);
  });

  it("rejects an identified opponent card in a private zone", () => {
    const replay = canonicalFixture();
    const snapshot = finalSnapshot(replay);
    snapshot.players.opponent!.zones.hand = [{
      id: "opaque-card-leak",
      name: "Private card",
      cardCode: "TST-001",
      fields: {},
    }];
    replay.checkpoints = buildReplayCheckpoints(replay);

    expect(() => verifyLocalTcgaPreviewReplay(rawFixture(), replay)).toThrow(/opponent_private_zone_identity/i);
  });

  it("rejects identity fields retained on a placeholder card", () => {
    const replay = canonicalFixture();
    const snapshot = finalSnapshot(replay);
    snapshot.players.opponent!.zones.hand[0]!.fields.cardData = { id: "TST-001" };
    replay.checkpoints = buildReplayCheckpoints(replay);

    expect(() => verifyLocalTcgaPreviewReplay(rawFixture(), replay)).toThrow(
      /placeholder_identity|raw_protocol_field/i,
    );
  });

  it("reads only explicit JSON or gzip JSON inputs without changing their data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "riftlite-tcga-builder-"));
    const value = { schema: "riftlite-tcga-raw-capture", version: 1 };
    const json = JSON.stringify(value);
    const jsonPath = join(directory, "fixture.json");
    const gzipPath = join(directory, "fixture.json.gz");
    await writeFile(jsonPath, json);
    await writeFile(gzipPath, gzipSync(json));

    await expect(readLocalTcgaRawCaptureFile(jsonPath)).resolves.toEqual(value);
    await expect(readLocalTcgaRawCaptureFile(gzipPath)).resolves.toEqual(value);
    await expect(readLocalTcgaRawCaptureFile(join(directory, "fixture.jsonl.gz"))).rejects.toThrow(/\.json/i);
  });

  it("derives a bounded lowercase fixture slug without embedding a path", () => {
    expect(defaultFixtureIdForInput("C:/private/TCGA Akali vs Irelia.json.gz")).toBe(
      "tcga-akali-vs-irelia",
    );
  });
});

function rawFixture(): TcgaReplayRawCaptureV1 {
  return {
    schema: "riftlite-tcga-raw-capture",
    version: 1,
    exportedAt: "2026-07-20T14:00:00.000Z",
    capture: {
      captureSessionId: "capture-safe",
      identity: {
        perspectivePlayerId: "raw-perspective-player-id",
        firstSeenAt: 1_000,
        lastSeenAt: 2_000,
      },
      lifecycle: {
        channelKey: "channel-safe",
        openedAt: 1_000,
        closedAt: 2_000,
        endedByLeaving: true,
      },
      source: {
        schema: "riftlite-tcga-research-session",
        version: 1,
        sha256: "a".repeat(64),
      },
    },
    transport: {
      frames: 2,
      decodedFrames: 2,
      logicalMessages: 2,
      chunkGroups: 0,
      completeChunkGroups: 0,
      incompleteChunkGroups: 0,
      incompleteChunkCount: 0,
      duplicateChunks: 0,
      issueCounts: {},
    },
    messages: [
      message(1, "out", "raw-perspective-player-id"),
      message(2, "in", "raw-opponent-player-id"),
    ],
  };
}

function message(
  seq: number,
  dir: "in" | "out",
  gameId: string,
): TcgaReplayRawCaptureV1["messages"][number] {
  return {
    seq,
    ts: 1_000 + seq,
    dir,
    firstTransportSequence: seq,
    completedTransportSequence: seq,
    parsed: { type: "PLAYER_DATA", gameId, payload: {} },
  };
}

function canonicalFixture(): CanonicalReplayV2 {
  const state: ReplayState = {
    seriesId: "tcga-series-safe",
    gameId: "tcga-game-safe",
    gameOrdinal: 1,
    phase: "in_game",
    appliedEventIndex: -1,
    room: {
      phase: "in_game",
      rawPhase: "tcga:in_game",
      gameNumber: 1,
      turnNumber: 3,
      fields: {},
    },
    players: {
      perspective: playerState("perspective", "Perspective legend", "Perspective battlefield", false),
      opponent: playerState("opponent", "Opponent legend", "Opponent battlefield", true),
    },
    chain: [],
    log: [],
    chat: [],
  };
  const replay: CanonicalReplayV2 = {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "tcga-replay-safe",
    source: {
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      captureSessionId: "opaque-capture-safe",
      roomCode: "",
      startedAt: 1_000,
      endedAt: 2_000,
      messageCount: 2,
    },
    series: {
      id: "tcga-series-safe",
      perspectivePlayerId: "perspective",
      format: "bo1",
      bestOf: 1,
      roomCode: "",
      startedAt: 1_000,
      endedAt: 2_000,
      participants: [
        participant("perspective", "Perspective battlefield", true),
        participant("opponent", "Opponent battlefield", false),
      ],
      games: [{
        id: "tcga-game-safe",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: [] },
        startedAt: 1_000,
        endedAt: 2_000,
        startedAtMs: 0,
        endedAtMs: 1_000,
        eventStartIndex: 0,
        eventEndIndex: 0,
        phases: [
          phase("mulligan", 0, 499),
          phase("in_game", 500, 1_000),
        ],
      }],
    },
    events: [{
      id: "event-safe-snapshot",
      index: 0,
      kind: "snapshot",
      at: 2_000,
      atMs: 1_000,
      sourceMessageId: "message-safe-snapshot",
      gameId: "tcga-game-safe",
      sequence: 1,
      snapshot: {
        room: state.room,
        players: state.players,
        chain: state.chain,
        log: state.log,
      },
    }],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
  replay.checkpoints = buildReplayCheckpoints(replay);
  return replay;
}

function participant(id: string, battlefield: string, isPerspective: boolean) {
  return {
    id,
    name: isPerspective ? "Perspective" : "Opponent",
    isPerspective,
    fields: { selectedBattlefield: battlefield },
  };
}

function playerState(id: string, legend: string, battlefield: string, hiddenHand: boolean) {
  return {
    id,
    name: id,
    fields: { selectedBattlefield: battlefield },
    boardFields: {},
    zones: {
      legend: [{ id: `${id}-legend`, name: legend, source: "legend", fields: {} }],
      hand: hiddenHand ? [{
        id: `${id}-hidden-card`,
        name: "",
        ownerPlayerId: id,
        source: "hand",
        isPlaceholder: true,
        fields: { ownerPlayerId: id, source: "hand", isPlaceholder: true },
      }] : [],
    },
  };
}

function phase(phaseName: "mulligan" | "in_game", startedAtMs: number, endedAtMs: number) {
  return {
    phase: phaseName,
    rawPhase: `tcga:${phaseName}`,
    startEventIndex: 0,
    endEventIndex: 0,
    startedAtMs,
    endedAtMs,
  };
}

function finalSnapshot(replay: CanonicalReplayV2) {
  const event = replay.events[0];
  if (event?.kind !== "snapshot") throw new Error("Expected snapshot fixture event.");
  return event.snapshot;
}
