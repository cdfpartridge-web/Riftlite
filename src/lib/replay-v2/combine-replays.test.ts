import { describe, expect, it } from "vitest";

import {
  combineCanonicalReplays,
  ReplayCombinationError,
  type ReplayCombineSource,
} from "@/lib/replay-v2/combine-replays";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import { stableDigest } from "@/lib/replay-v2/stable-id";
import type {
  CanonicalReplayV2,
  ReplayActionEvent,
  ReplayCardState,
  ReplaySnapshotEvent,
} from "@/lib/replay-v2/types";

describe("combineCanonicalReplays", () => {
  it("reveals both players' hands on one deterministic timeline and rebuilds checkpoints", () => {
    const sourceA = source("source-a", "player-a");
    const sourceB = source("source-b", "player-b");

    const replay = combineCanonicalReplays({
      replayId: "combined-1",
      sources: [sourceB, sourceA],
      checkpoints: { everyEvents: 1 },
    });

    const state = projectReplayState(replay);
    expect(state.players["player-a"].zones.hand[0]).toMatchObject({
      id: "a-hand",
      name: "Alpha Unit",
      cardCode: "TST-001",
      isPlaceholder: false,
    });
    expect(state.players["player-b"].zones.hand[0]).toMatchObject({
      id: "b-hand",
      name: "Beta Unit",
      cardCode: "TST-002",
      isPlaceholder: false,
    });
    expect(replay.collaboration).toMatchObject({
      schema: "riftlite-dual-perspective",
      mode: "dual-perspective",
      sourceReplayIds: ["source-a", "source-b"],
      sourceCanonicalSha256s: ["a".repeat(64), "b".repeat(64)],
      perspectivePlayerIds: ["player-a", "player-b"],
      informationPolicy: "consented_full_information",
      confidence: "exact",
      diagnostics: {
        primarySourceReplayId: "source-a",
        pairedSnapshotEvents: 1,
        pairedActionEvents: 1,
        unpairedPrimaryEvents: 0,
        unpairedSecondaryEvents: 0,
      },
    });
    expect(replay.source.roomCode).toBe("");
    expect(replay.series.roomCode).toBe("");
    expect(replay.checkpoints.length).toBeGreaterThan(1);
    replay.checkpoints.forEach((checkpoint) => {
      expect(checkpoint.stateHash).toBe(stableDigest(checkpoint.state));
    });

    const reversed = combineCanonicalReplays({
      replayId: "combined-1",
      sources: [sourceA, sourceB],
      checkpoints: { everyEvents: 1 },
    });
    expect(reversed).toEqual(replay);
  });

  it("enriches the actor's stripped sideboard choice and matching hidden patch fields", () => {
    const replay = combineCanonicalReplays({
      replayId: "combined-sideboard",
      sources: [source("source-a", "player-a"), source("source-b", "player-b")],
    });
    const action = replay.events.find((event): event is ReplayActionEvent => event.kind === "action");

    expect(action?.action).toMatchObject({
      type: "submit_sideboard",
      mainDeck: [{ name: "Beta Unit", cardCode: "TST-002" }],
      sideboard: [{ name: "Gamma Unit", cardCode: "TST-003" }],
    });
    expect(action?.patch.operations[0]).toMatchObject({
      op: "set_player_fields",
      playerId: "player-b",
      fields: {
        publicMarker: "ready",
        sideboard: [{ name: "Gamma Unit", cardCode: "TST-003" }],
      },
    });
    expect(replay.collaboration?.diagnostics.enrichedFields).toBeGreaterThan(0);
  });

  it("rejects mismatched participants and captures from the same perspective", () => {
    const participantMismatch = source("source-b", "player-b");
    participantMismatch.replay.series.participants[1].id = "player-c";
    expectCombinationError(
      () => combineCanonicalReplays({
        replayId: "combined-invalid-players",
        sources: [source("source-a", "player-a"), participantMismatch],
      }),
      "participant_mismatch",
    );

    expectCombinationError(
      () => combineCanonicalReplays({
        replayId: "combined-invalid-perspective",
        sources: [source("source-a", "player-a"), source("source-b", "player-a")],
      }),
      "perspective_mismatch",
    );
  });

  it("rejects material conflicts in aligned authoritative state", () => {
    const sourceB = source("source-b", "player-b");
    const snapshot = sourceB.replay.events[0] as ReplaySnapshotEvent;
    snapshot.snapshot.players["player-b"].score = 4;

    expectCombinationError(
      () => combineCanonicalReplays({
        replayId: "combined-conflict",
        sources: [source("source-a", "player-a"), sourceB],
      }),
      "material_conflict",
    );
  });

  it("does not trust a shared room without a capture window and event fingerprint", () => {
    const left = source("source-a", "player-a", { seriesId: "", matchId: "left", capturedAt: undefined });
    const right = source("source-b", "player-b", { seriesId: "", matchId: "right", capturedAt: undefined });
    left.replay.series.id = "left-series";
    right.replay.series.id = "right-series";
    left.replay.events = left.replay.events.slice(0, 1);
    right.replay.events = right.replay.events.slice(0, 1);

    expectCombinationError(
      () => combineCanonicalReplays({ replayId: "combined-room-only", sources: [left, right] }),
      "identity_mismatch",
    );
  });

  it("aligns authoritative sequences when only the acting perspective knows the actor", () => {
    const left = source("source-a", "player-a", {
      seriesId: "left-series",
      matchId: "left-match",
      capturedAt: undefined,
    });
    const right = source("source-b", "player-b", {
      seriesId: "right-series",
      matchId: "right-match",
      capturedAt: undefined,
    });
    left.replay.series.id = "left-canonical-series";
    right.replay.series.id = "right-canonical-series";
    const leftAction = left.replay.events[1] as ReplayActionEvent;
    const rightAction = right.replay.events[1] as ReplayActionEvent;
    delete leftAction.actorPlayerId;
    rightAction.actorPlayerId = "player-b";
    left.replay.events = [left.replay.events[0], ...repeatAction(leftAction, "left")];
    right.replay.events = [right.replay.events[0], ...repeatAction(rightAction, "right")];
    left.replay.series.games[0].eventEndIndex = 4;
    right.replay.series.games[0].eventEndIndex = 4;

    const replay = combineCanonicalReplays({
      replayId: "combined-perspective-actor",
      sources: [left, right],
    });

    expect(replay.collaboration?.confidence).toBe("strong");
    expect(replay.collaboration?.diagnostics.pairedActionEvents).toBe(4);
    expect(replay.collaboration?.diagnostics.warningCodes).toContain("shared_room_confirmed_by_event_fingerprint");
    const actions = replay.events.filter((event): event is ReplayActionEvent => event.kind === "action");
    expect(actions.every((event) => event.actorPlayerId === "player-b")).toBe(true);
  });

  it("merges owner-only operations and preserves known hidden cards across an unpaired snapshot", () => {
    const left = source("source-a", "player-a");
    const right = source("source-b", "player-b");
    const leftAction = left.replay.events[1] as ReplayActionEvent;
    leftAction.patch.operations = [];
    const extraSnapshot = cloneReplayValue(left.replay.events[0] as ReplaySnapshotEvent);
    extraSnapshot.id = "source-a-unpaired-snapshot";
    extraSnapshot.index = 2;
    extraSnapshot.at += 2_000;
    extraSnapshot.atMs += 2_000;
    extraSnapshot.sequence = 99;
    left.replay.events.push(extraSnapshot);
    left.replay.series.games[0].eventEndIndex = 2;

    const replay = combineCanonicalReplays({
      replayId: "combined-private-operation",
      sources: [left, right],
    });
    const state = projectReplayState(replay);
    const combinedAction = replay.events.find((event): event is ReplayActionEvent => event.kind === "action");

    expect(state.players["player-b"].zones.hand[0]).toMatchObject({
      id: "b-hand",
      name: "Beta Unit",
      isPlaceholder: false,
    });
    expect(combinedAction?.patch.operations).toContainEqual(expect.objectContaining({
      op: "set_player_fields",
      playerId: "player-b",
    }));
    expect(replay.collaboration?.diagnostics.warningCodes).toEqual(expect.arrayContaining([
      "merged_secondary_private_operation",
      "preserved_hidden_state_across_snapshot",
    ]));
  });
});

function repeatAction(action: ReplayActionEvent, prefix: string): ReplayActionEvent[] {
  return Array.from({ length: 4 }, (_, index) => {
    const copy = cloneReplayValue(action);
    copy.id = `${prefix}-action-${index + 1}`;
    copy.index = index + 1;
    copy.at += index * 1_000;
    copy.atMs += index * 1_000;
    copy.patch.baseSequence = index + 1;
    copy.patch.sequence = index + 2;
    copy.confirmation.commitMessageId = `${prefix}-commit-${index + 1}`;
    return copy;
  });
}

function cloneReplayValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectCombinationError(run: () => unknown, code: ReplayCombinationError["code"]): void {
  try {
    run();
    throw new Error("Expected replay combination to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayCombinationError);
    expect((error as ReplayCombinationError).code).toBe(code);
  }
}

function source(
  replayId: "source-a" | "source-b",
  perspectivePlayerId: "player-a" | "player-b",
  identityOverrides: Partial<NonNullable<ReplayCombineSource["identity"]>> = {},
): ReplayCombineSource {
  return {
    replayId,
    canonicalSha256: replayId === "source-a" ? "a".repeat(64) : "b".repeat(64),
    replay: canonicalReplay(perspectivePlayerId, replayId),
    identity: {
      seriesId: "remote-series-1",
      matchId: replayId === "source-a" ? "local-match-a" : "local-match-b",
      roomCode: "ROOM1",
      capturedAt: replayId === "source-a" ? 1_700_000_000_000 : 1_700_000_000_500,
      ...identityOverrides,
    },
  };
}

function canonicalReplay(
  perspectivePlayerId: "player-a" | "player-b",
  sourceId: "source-a" | "source-b",
): CanonicalReplayV2 {
  const ownA = perspectivePlayerId === "player-a";
  const aHand = ownA ? card("a-hand", "Alpha Unit", "TST-001", "player-a") : hiddenCard("a-hand", "player-a");
  const bHand = ownA ? hiddenCard("b-hand", "player-b") : card("b-hand", "Beta Unit", "TST-002", "player-b");
  const snapshot: ReplaySnapshotEvent = {
    id: `${sourceId}-snapshot`,
    index: 0,
    at: 1_700_000_000_000,
    atMs: 0,
    sourceMessageId: `${sourceId}-message-1`,
    gameId: "game-1",
    kind: "snapshot",
    sequence: 1,
    snapshot: {
      room: {
        phase: "mulligan",
        rawPhase: "mulligan",
        gameNumber: 1,
        fields: { phase: "mulligan", gameNumber: 1 },
      },
      players: {
        "player-a": {
          id: "player-a",
          name: "Player A",
          score: 0,
          fields: ownA ? { publicMarker: "ready", hand: [{ id: "a-hand" }] } : { publicMarker: "ready" },
          boardFields: { score: 0 },
          zones: { hand: [aHand] },
        },
        "player-b": {
          id: "player-b",
          name: "Player B",
          score: 0,
          fields: ownA ? { publicMarker: "ready" } : { publicMarker: "ready", hand: [{ id: "b-hand" }] },
          boardFields: { score: 0 },
          zones: { hand: [bHand] },
        },
      },
      chain: [],
      log: [],
    },
  };
  const action: ReplayActionEvent = {
    id: `${sourceId}-action`,
    index: 1,
    at: 1_700_000_001_000,
    atMs: 1_000,
    sourceMessageId: `${sourceId}-message-2`,
    gameId: "game-1",
    kind: "action",
    actionType: "submit_sideboard",
    actorPlayerId: "player-b",
    action: perspectivePlayerId === "player-b"
      ? {
          type: "submit_sideboard",
          mainDeck: [{ name: "Beta Unit", cardCode: "TST-002" }],
          sideboard: [{ name: "Gamma Unit", cardCode: "TST-003" }],
        }
      : { type: "submit_sideboard" },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: perspectivePlayerId === "player-b" ? "matched_intent" : "intent_not_observed",
      ...(perspectivePlayerId === "player-b" ? { clientActionId: "client-sideboard-b" } : {}),
      commitMessageId: `${sourceId}-message-2`,
    },
    patch: {
      baseSequence: 1,
      sequence: 2,
      operations: [{
        id: `${sourceId}-operation`,
        op: "set_player_fields",
        playerId: "player-b",
        fields: perspectivePlayerId === "player-b"
          ? {
              publicMarker: "ready",
              sideboard: [{ name: "Gamma Unit", cardCode: "TST-003" }],
            }
          : { publicMarker: "ready" },
      }],
    },
  };

  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: sourceId,
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: `${sourceId}-capture`,
      roomCode: "PRIVATE-ROOM",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      messageCount: 2,
    },
    series: {
      id: "canonical-series-1",
      perspectivePlayerId,
      format: "bo1",
      bestOf: 1,
      roomCode: "PRIVATE-ROOM",
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_001_000,
      participants: [
        {
          id: "player-a",
          name: "Player A",
          isPerspective: perspectivePlayerId === "player-a",
          fields: perspectivePlayerId === "player-a" ? { deck: ["TST-001"] } : {},
        },
        {
          id: "player-b",
          name: "Player B",
          isPerspective: perspectivePlayerId === "player-b",
          fields: perspectivePlayerId === "player-b" ? { deck: ["TST-002"] } : {},
        },
      ],
      games: [{
        id: "game-1",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["private-game-id"] },
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_001_000,
        startedAtMs: 0,
        endedAtMs: 1_000,
        eventStartIndex: 0,
        eventEndIndex: 1,
        phases: [],
      }],
    },
    events: [snapshot, action],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function card(
  id: string,
  name: string,
  cardCode: string,
  ownerPlayerId: string,
): ReplayCardState {
  return {
    id,
    name,
    cardCode,
    ownerPlayerId,
    source: "hand",
    isPlaceholder: false,
    fields: { id, name, cardCode, ownerPlayerId, source: "hand" },
  };
}

function hiddenCard(id: string, ownerPlayerId: string): ReplayCardState {
  return {
    id,
    name: "",
    ownerPlayerId,
    source: "hand",
    isPlaceholder: true,
    fields: { id, ownerPlayerId, source: "hand", isPlaceholder: true },
  };
}
