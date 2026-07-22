import { describe, expect, it } from "vitest";

import { assessReplayPublicationQuality } from "@/lib/replay-v2/replay-quality";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import type { JsonObject } from "@/lib/replay-v2/types";
import {
  inspectTcgaCanonicalReplay,
  normalizeTcgaReplayRawCaptureV1,
  parseTcgaReplayRawCaptureV1,
  type TcgaReplayRawCaptureV1,
  type TcgaReplayRawMessageV1,
} from "@/lib/replay-v2/tcga";

describe("TCGA raw capture validation", () => {
  it("accepts the decoded, single-channel desktop envelope", () => {
    expect(parseTcgaReplayRawCaptureV1(fixture())).toMatchObject({
      schema: "riftlite-tcga-raw-capture",
      version: 1,
      capture: { identity: { perspectivePlayerId: "provider-self-secret" } },
    });
  });

  it("rejects a perspective that does not match the sole outbound player", () => {
    const input = fixture();
    input.capture.identity.perspectivePlayerId = "provider-opponent-secret";
    expect(() => parseTcgaReplayRawCaptureV1(input)).toThrow(/sole outbound/i);
  });

  it("rejects duplicate source sequences and inconsistent transport provenance", () => {
    const duplicate = fixture();
    duplicate.messages[1].seq = duplicate.messages[0].seq;
    expect(() => parseTcgaReplayRawCaptureV1(duplicate)).toThrow(/duplicate source sequence/i);

    const backwards = fixture();
    backwards.messages[0].firstTransportSequence = 2;
    backwards.messages[0].completedTransportSequence = 1;
    expect(() => parseTcgaReplayRawCaptureV1(backwards)).toThrow(/first transport sequence/i);
  });

  it("accepts the strict product envelope and complete match metadata", () => {
    const input = productFixture({
      result: "win",
      perspectivePoints: 8,
      opponentPoints: 5,
    });

    expect(parseTcgaReplayRawCaptureV1(input).capture).toMatchObject({
      source: { schema: "riftlite-tcga-web-replay" },
      match: { result: "win", perspectivePoints: 8, opponentPoints: 5 },
    });
  });

  it("rejects partial match scores and lossy product transport", () => {
    const partialScore = productFixture({ result: "draw", perspectivePoints: 5 });
    expect(() => parseTcgaReplayRawCaptureV1(partialScore)).toThrow(/complete pair/i);

    const incompleteTransport = productFixture({ result: "draw" });
    incompleteTransport.transport.chunkGroups = 1;
    incompleteTransport.transport.incompleteChunkGroups = 1;
    incompleteTransport.transport.incompleteChunkCount = 1;
    incompleteTransport.transport.issueCounts = { missingChunk: 1 };
    expect(() => parseTcgaReplayRawCaptureV1(incompleteTransport)).toThrow(/complete and issue-free/i);

    const undecodedFrame = productFixture({ result: "draw" });
    undecodedFrame.transport.frames += 1;
    expect(() => parseTcgaReplayRawCaptureV1(undecodedFrame)).toThrow(/complete and issue-free/i);
  });

  it("rejects product captures without an authoritative completed result", () => {
    const missing = fixture();
    missing.capture.source.schema = "riftlite-tcga-web-replay";
    expect(() => parseTcgaReplayRawCaptureV1(missing)).toThrow(/completed match result/i);

    const incomplete = fixture();
    incomplete.capture.source.schema = "riftlite-tcga-web-replay";
    incomplete.capture.match = { result: "incomplete" };
    expect(() => parseTcgaReplayRawCaptureV1(incomplete)).toThrow(/completed match result/i);
  });
});

describe("normalizeTcgaReplayRawCaptureV1", () => {
  it("deterministically produces a playable snapshot/log replay with an unresolved result", () => {
    const first = normalizeTcgaReplayRawCaptureV1(fixture(), { replayId: "tcga_fixture" });
    const second = normalizeTcgaReplayRawCaptureV1(fixture(), { replayId: "tcga_fixture" });

    expect(second).toEqual(first);
    expect(first.source).toMatchObject({
      schema: "riftlite-tcga-raw-capture",
      captureSessionId: "",
      roomCode: "",
    });
    expect(first.series.participants).toHaveLength(2);
    expect(first.series.participants.map((participant) => participant.fields.legend)).toEqual([
      { name: "Akali, Rogue Assassin", cardCode: "OGN-001", source: "legend" },
      { name: "Irelia, Blade Dancer", cardCode: "OGN-002", source: "legend" },
    ]);
    expect(first.series.participants.map((participant) => participant.fields.champion)).toEqual([
      { name: "Akali, Silent Death", cardCode: "OGN-003", source: "champion" },
      { name: "Irelia, The Blade Dancer", cardCode: "OGN-004", source: "champion" },
    ]);
    expect(first.series.games).toHaveLength(1);
    expect(first.series.games[0].result).toBeUndefined();
    expect(first.series.result).toBeUndefined();
    expect(first.events.some((event) => (
      event.kind === "game_boundary" && event.boundary === "end"
    ))).toBe(false);
    expect(first.diagnostics.map((entry) => entry.code)).toContain("terminal_result_unknown");
    expect(new Set(first.events.map((event) => event.index)).size).toBe(first.events.length);
    expect(first.events.map((event) => event.index)).toEqual(first.events.map((_, index) => index));
    expect(first.events.some((event) => event.kind === "snapshot")).toBe(true);
    expect(first.events.some((event) => event.kind === "log")).toBe(true);
    expect(first.series.games[0].phases.map((phase) => phase.phase)).toEqual([
      "matchup",
      "battlefield_pick",
      "first_player_choice",
      "mulligan",
      "in_game",
    ]);
    expect(assessReplayPublicationQuality(first)).toEqual({ publishable: true, issues: [] });

    const finalState = projectReplayState(first);
    expect(finalState.room.turnNumber).toBe(1);
    expect(finalState.room.fields.providerTurnCount).toBe(2);
    expect(Object.values(finalState.players).map((player) => player.score).sort()).toEqual([7, 7]);
    expect(finalState.log.some((entry) => entry.text === "Turn 2 started")).toBe(true);
    expect(first.checkpoints.length).toBeLessThan(first.events.length);
  });

  it("preserves an authoritative TCGA mulligan redraw count without claiming hidden card identities", () => {
    const input = fixture();
    const mulliganMessage = input.messages.find((entry) => entry.seq === 4);
    if (!mulliganMessage || !mulliganMessage.parsed.payload) {
      throw new Error("Missing mulligan fixture message");
    }
    (mulliganMessage.parsed.payload as JsonObject).newToHistory = {
      id: "provider-history-mulligan-redraw",
      playerId: "provider-self-secret",
      text: "play.logs.game.mulligan.drawAgainX",
      params: { count: 2 },
    };

    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_mulligan_count" });
    const redrawLog = replay.events
      .filter((event) => event.kind === "log")
      .flatMap((event) => event.entries)
      .find((entry) => entry.fields.mulliganRedrawCount === 2);

    expect(redrawLog).toMatchObject({
      authorPlayerId: replay.series.perspectivePlayerId,
      text: "Local Tester replaced 2 cards",
      fields: { provider: "tcga", mulliganRedrawCount: 2 },
    });
    expect(JSON.stringify(redrawLog)).not.toContain("provider-self-secret");
  });

  it("reconstructs an exact perspective mulligan only from a uniquely proven deck delta", () => {
    const input = mulliganDeckFixture("exact");
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_exact_mulligan" });
    const action = replay.events.find((event) => event.kind === "action" && event.actionType === "submit_mulligan");
    if (!action || action.kind !== "action") throw new Error("Missing exact mulligan action");
    const perspectivePlayerId = replay.series.perspectivePlayerId ?? "";
    const before = projectReplayState(replay, action.index - 1).players[perspectivePlayerId];
    const after = projectReplayState(replay, action.index).players[perspectivePlayerId];
    const selectedIds = new Set(Array.isArray(action.action.cardIds) ? action.action.cardIds : []);

    expect(before.zones.hand.map((entry) => entry.name)).toEqual([
      "Aurok General",
      "Ruin Runner",
      "Kayle, Justified",
      "Challenge",
    ]);
    expect(before.zones.hand.filter((entry) => selectedIds.has(entry.id)).map((entry) => entry.name)).toEqual([
      "Aurok General",
      "Challenge",
    ]);
    expect(before.zones.deck).toHaveLength(6);
    expect(new Set(Object.values(before.zones).flat().map((entry) => entry.id)).size).toBe(
      Object.values(before.zones).flat().length,
    );
    expect(after.zones.hand.map((entry) => entry.name)).toEqual([
      "Ruin Runner",
      "Kayle, Justified",
      "Sabotage",
      "Repulse",
    ]);
    expect(after.zones.deck).toHaveLength(6);
    expect(action.patch.operations.map((operation) => operation.op)).toEqual([
      "set_room_fields",
      "zone_remove",
      "zone_insert",
    ]);
    expect(inspectTcgaCanonicalReplay(input, replay)).toEqual({ integrityIssues: [], privacyIssues: [] });
  });

  it("accepts TCGA's reversed order when selected cards are returned to the proven deck boundary", () => {
    const input = mulliganDeckFixture("boundary_reversed");
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_reversed_boundary_mulligan" });
    const action = replay.events.find((event) => event.kind === "action" && event.actionType === "submit_mulligan");

    expect(action).toMatchObject({
      kind: "action",
      actionType: "submit_mulligan",
      confirmation: { status: "confirmed", authority: "authoritative_patch_commit" },
    });
    expect(inspectTcgaCanonicalReplay(input, replay)).toEqual({ integrityIssues: [], privacyIssues: [] });
  });

  it.each(["ambiguous"] as const)(
    "falls back to count-only mulligan evidence when the perspective deck delta is %s",
    (variant) => {
      const input = mulliganDeckFixture(variant);
      const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: `tcga_${variant}_mulligan` });

      expect(replay.events.some((event) => event.kind === "action" && event.actionType === "submit_mulligan"))
        .toBe(false);
      expect(replay.events
        .filter((event) => event.kind === "log")
        .flatMap((event) => event.entries)
        .some((entry) => entry.fields.mulliganRedrawCount === 2))
        .toBe(true);
      expect(inspectTcgaCanonicalReplay(input, replay)).toEqual({ integrityIssues: [], privacyIssues: [] });
    },
  );

  it("uses opaque identities and removes every hidden card identity before serialization", () => {
    const replay = normalizeTcgaReplayRawCaptureV1(fixture(), { replayId: "tcga_private" });
    const serialized = JSON.stringify(replay);

    for (const secret of [
      "provider-self-secret",
      "provider-opponent-secret",
      "provider-channel-secret",
      "provider-capture-secret",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "Opponent Hidden Hand Secret",
      "Opponent Sideboard Leak",
      "Opponent Hidden Exile Secret",
      "Local Ordered Deck Secret",
      "provider-hidden-hand-card",
      "provider-sideboard-card",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("Akali, Rogue Assassin");
    expect(serialized).toContain("Irelia, Blade Dancer");
    expect(serialized).toContain("Local Visible Hand");

    const snapshots = replay.events.filter((event) => event.kind === "snapshot");
    const finalSnapshot = snapshots.at(-1);
    expect(finalSnapshot?.kind).toBe("snapshot");
    if (!finalSnapshot || finalSnapshot.kind !== "snapshot") throw new Error("Missing snapshot");
    const opponentId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";
    const opponent = finalSnapshot.snapshot.players[opponentId];
    expect(opponent.zones.hand[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(opponent.zones.sideboard[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(opponent.zones.removed[0]).toMatchObject({ name: "", isPlaceholder: true });
    expect(opponent.zones.hand[0].cardCode).toBeUndefined();
    const selfId = replay.series.perspectivePlayerId ?? "";
    expect(finalSnapshot.snapshot.players[selfId].zones.deck[0]).toMatchObject({
      name: "",
      isPlaceholder: true,
    });
  });

  it("preserves the last known zone during TCGA transient section=false updates", () => {
    const replay = normalizeTcgaReplayRawCaptureV1(fixture(), { replayId: "tcga_zone" });
    const snapshots = replay.events.filter((event) => event.kind === "snapshot");
    const finalSnapshot = snapshots.at(-1);
    if (!finalSnapshot || finalSnapshot.kind !== "snapshot") throw new Error("Missing snapshot");
    const opponentId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";
    expect(finalSnapshot.snapshot.players[opponentId].zones.battlefieldA).toHaveLength(1);
    expect(finalSnapshot.snapshot.players[opponentId].zones.unknown).toHaveLength(0);
  });

  it("preserves owner-relative battlefield lanes when the perspective player is second", () => {
    const input = fixture();
    input.messages = [
      ...input.messages.slice(0, -1),
      message(8, 2_025, "out", {
        type: "GAME_DATA",
        gameId: "provider-self-secret",
        payload: { playerData: { turnOrderPosition: 1 } },
      }),
      message(9, 2_050, "in", {
        type: "GAME_DATA",
        gameId: "provider-opponent-secret",
        payload: { playerData: { turnOrderPosition: 0 } },
      }),
      message(10, 2_100, "out", {
        type: "LEAVING",
        gameId: "provider-self-secret",
        payload: {},
      }),
    ];
    input.transport.frames = input.messages.length;
    input.transport.decodedFrames = input.messages.length;
    input.transport.logicalMessages = input.messages.length;

    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_second_player_lanes" });
    const perspectiveId = replay.series.perspectivePlayerId ?? "";
    const opponentId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";
    const finalSnapshot = replay.events.filter((event) => event.kind === "snapshot").at(-1);
    if (!finalSnapshot || finalSnapshot.kind !== "snapshot") throw new Error("Missing snapshot");

    expect(replay.series.participants.find((participant) => participant.id === perspectiveId)).toMatchObject({
      seat: 0,
      fields: { turnOrderPosition: 1 },
    });
    expect(replay.series.participants.find((participant) => participant.id === opponentId)).toMatchObject({
      seat: 1,
      fields: { turnOrderPosition: 0 },
    });
    expect(finalSnapshot.snapshot.players[perspectiveId]).toMatchObject({
      seat: 0,
      fields: { turnOrderPosition: 1 },
    });
    expect(finalSnapshot.snapshot.players[opponentId]).toMatchObject({
      seat: 1,
      fields: { turnOrderPosition: 0 },
    });
    expect(finalSnapshot.snapshot.players[perspectiveId].zones.battlefieldA)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "Local Unit" })]));
    expect(finalSnapshot.snapshot.players[opponentId].zones.battlefieldA)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "Opponent Unit" })]));
  });

  it("uses TCGA position indexes instead of transport order for visible card zones", () => {
    const input = fixture();
    const state = player("self", 10);
    const visibleCards = state.visibleCards as JsonObject[];
    const positioned = [
      card("resource-two", "provider-self-secret", "Mana", "Resource Two", "OGN-102", { status: "no" }),
      card("resource-zero", "provider-self-secret", "Mana", "Resource Zero", "OGN-100", { status: "no" }),
      card("resource-one", "provider-self-secret", "Mana", "Resource One", "OGN-101", { status: "no" }),
      card("unit-one", "provider-self-secret", "B1", "Unit One", "OGN-111", { status: "no" }),
      card("unit-zero", "provider-self-secret", "B1", "Unit Zero", "OGN-110", { status: "no" }),
    ];
    [2, 0, 1, 1, 0].forEach((positionIndex, index) => {
      positioned[index].position = {
        ...(positioned[index].position as JsonObject),
        index: positionIndex,
      };
    });
    state.visibleCards = [
      ...visibleCards.filter((entry) => !["self-unit", "provider-local-hand-card"].includes(String(entry.id))),
      ...positioned,
    ];
    input.messages = [
      ...input.messages.slice(0, -1),
      message(8, 2_025, "out", {
        type: "GAME_DATA",
        gameId: "provider-self-secret",
        payload: { playerData: state },
      }),
      message(9, 2_100, "out", {
        type: "LEAVING",
        gameId: "provider-self-secret",
        payload: {},
      }),
    ];
    input.transport.frames = input.messages.length;
    input.transport.decodedFrames = input.messages.length;
    input.transport.logicalMessages = input.messages.length;

    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_position_order" });
    const perspectiveId = replay.series.perspectivePlayerId ?? "";
    const finalSnapshot = replay.events.filter((event) => event.kind === "snapshot").at(-1);
    if (!finalSnapshot || finalSnapshot.kind !== "snapshot") throw new Error("Missing snapshot");

    expect(finalSnapshot.snapshot.players[perspectiveId].zones.runeArea.map((entry) => entry.name)).toEqual([
      "Resource Zero",
      "Resource One",
      "Resource Two",
    ]);
    expect(finalSnapshot.snapshot.players[perspectiveId].zones.battlefieldA.map((entry) => entry.name)).toEqual([
      "Unit Zero",
      "Unit One",
    ]);
  });

  it("moves grouped cards with their host and preserves positional counter changes", () => {
    const input = fixture();
    input.messages = [
      ...input.messages.slice(0, -1),
      message(8, 2_020, "in", {
        type: "GAME_DATA",
        gameId: "provider-opponent-secret",
        payload: {
          playerData: groupedOpponentPlayer("Base", [{ value: 0 }, { value: -3 }]),
        },
      }),
      message(9, 2_050, "in", {
        type: "GAME_DATA",
        gameId: "provider-opponent-secret",
        payload: {
          playerData: groupedOpponentPlayer("B2", [{ value: 5 }, { value: 0 }]),
        },
      }),
      message(10, 2_080, "in", {
        type: "GAME_DATA",
        gameId: "provider-opponent-secret",
        payload: {
          playerData: groupedOpponentPlayer("B2", [{}, {}]),
        },
      }),
      message(11, 2_100, "out", {
        type: "LEAVING",
        gameId: "provider-self-secret",
        payload: {},
      }),
    ];
    input.transport.frames = input.messages.length;
    input.transport.decodedFrames = input.messages.length;
    input.transport.logicalMessages = input.messages.length;

    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_grouped_counter" });
    const snapshots = replay.events.filter((event) => event.kind === "snapshot");
    const [atBase, atBattlefield, countersCleared] = snapshots.slice(-3);
    const opponentId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";

    if (
      atBase?.kind !== "snapshot" ||
      atBattlefield?.kind !== "snapshot" ||
      countersCleared?.kind !== "snapshot"
    ) {
      throw new Error("Missing grouped-card snapshots");
    }

    const baseHost = atBase.snapshot.players[opponentId].zones.base.find((entry) => entry.name === "Opponent Unit");
    const baseAttachment = atBase.snapshot.players[opponentId].zones.base.find((entry) => entry.name === "Guardian Angel");
    expect(baseHost?.fields).toMatchObject({ whiteCounter: 0, redCounter: -3 });
    expect(baseAttachment?.fields.attachedToCardId).toBe(baseHost?.id);

    const movedHost = atBattlefield.snapshot.players[opponentId].zones.battlefieldB
      .find((entry) => entry.name === "Opponent Unit");
    const movedAttachment = atBattlefield.snapshot.players[opponentId].zones.battlefieldB
      .find((entry) => entry.name === "Guardian Angel");
    expect(movedHost?.fields).toMatchObject({ whiteCounter: 5, redCounter: 0 });
    expect(movedAttachment?.fields.attachedToCardId).toBe(movedHost?.id);
    expect(atBattlefield.snapshot.players[opponentId].zones.base).toHaveLength(0);

    const clearedHost = countersCleared.snapshot.players[opponentId].zones.battlefieldB
      .find((entry) => entry.name === "Opponent Unit");
    expect(clearedHost?.fields.whiteCounter).toBeUndefined();
    expect(clearedHost?.fields.redCounter).toBeUndefined();
  });

  it.each([
    ["win", true, false, 1, 0],
    ["loss", false, true, 0, 1],
    ["draw", false, false, 0, 0],
  ] as const)("maps authoritative desktop %s metadata to a terminal replay result", (
    result,
    perspectiveWins,
    opponentWins,
    perspectiveGameWins,
    opponentGameWins,
  ) => {
    const input = productFixture({
      result,
      perspectivePoints: 8,
      opponentPoints: 5,
    });
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: `tcga_result_${result}` });
    const perspectivePlayerId = replay.series.perspectivePlayerId ?? "";
    const opponentPlayerId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";
    const game = replay.series.games[0];

    expect(game.result?.finalScores).toEqual({
      [perspectivePlayerId]: 8,
      [opponentPlayerId]: 5,
    });
    expect(game.result?.winnerPlayerId).toBe(
      perspectiveWins ? perspectivePlayerId : opponentWins ? opponentPlayerId : undefined,
    );
    expect(game.result?.loserPlayerId).toBe(
      perspectiveWins ? opponentPlayerId : opponentWins ? perspectivePlayerId : undefined,
    );
    expect(replay.series.result).toMatchObject({
      resultEventId: game.result?.resultEventId,
      source: "desktop_match_metadata",
      outcome: result,
      finalScores: {
        [perspectivePlayerId]: perspectiveGameWins,
        [opponentPlayerId]: opponentGameWins,
      },
    });
    expect(game.sourceIdentity.resultEventId).toBe(game.result?.resultEventId);
    expect(game.phases.at(-1)?.phase).toBe("game_end");
    expect(replay.events.at(-1)).toMatchObject({
      kind: "game_boundary",
      boundary: "end",
      reason: "explicit_result",
    });
    expect(replay.diagnostics.map((entry) => entry.code)).not.toContain("terminal_result_unknown");
    expect(assessReplayPublicationQuality(replay)).toEqual({ publishable: true, issues: [] });
    expect(inspectTcgaCanonicalReplay(input, replay)).toEqual({
      integrityIssues: [],
      privacyIssues: [],
    });
  });

  it("keeps the match-logger BO1 result authoritative when point totals are unavailable", () => {
    const input = productFixture({ result: "loss" });
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_result_without_points" });
    const perspectivePlayerId = replay.series.perspectivePlayerId ?? "";
    const opponentPlayerId = replay.series.participants.find((participant) => !participant.isPerspective)?.id ?? "";

    expect(replay.series.games[0]?.result?.finalScores).toBeUndefined();
    expect(replay.series.result).toMatchObject({
      source: "desktop_match_metadata",
      outcome: "loss",
      winnerPlayerId: opponentPlayerId,
      loserPlayerId: perspectivePlayerId,
      finalScores: {
        [perspectivePlayerId]: 0,
        [opponentPlayerId]: 1,
      },
    });
    expect(inspectTcgaCanonicalReplay(input, replay)).toEqual({
      integrityIssues: [],
      privacyIssues: [],
    });
  });

  it("keeps legacy research captures without a completed match result unresolved", () => {
    const input = fixture();
    input.capture.match = { result: "incomplete" };
    const replay = normalizeTcgaReplayRawCaptureV1(input, {
      replayId: "tcga_result_incomplete",
    });

    expect(replay.series.games[0].result).toBeUndefined();
    expect(replay.series.result).toBeUndefined();
    expect(replay.events.some((event) => event.kind === "game_boundary" && event.boundary === "end")).toBe(false);
    expect(replay.diagnostics.map((entry) => entry.code)).toContain("terminal_result_unknown");
  });
});

describe("TCGA canonical publication verification", () => {
  it("detects identities in perspective deck and unknown zones", () => {
    const input = fixture();
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_private_verification" });
    const finalSnapshot = replay.events.filter((event) => event.kind === "snapshot").at(-1);
    if (!finalSnapshot || finalSnapshot.kind !== "snapshot") throw new Error("Missing snapshot");
    const perspectivePlayerId = replay.series.perspectivePlayerId ?? "";
    finalSnapshot.snapshot.players[perspectivePlayerId].zones.deck[0].name = "Leaked deck identity";
    finalSnapshot.snapshot.players[perspectivePlayerId].zones.unknown.push({
      id: "opaque-leak",
      name: "Leaked unknown identity",
      cardCode: "OGN-999",
      isPlaceholder: false,
      fields: {},
    });

    expect(inspectTcgaCanonicalReplay(input, replay).privacyIssues).toContain("private_zone_identity");
  });

  it("detects copied raw source identifiers and checkpoint tampering", () => {
    const input = fixture();
    const replay = normalizeTcgaReplayRawCaptureV1(input, { replayId: "tcga_integrity_verification" });
    replay.series.participants[0].fields.rawLeak = "provider-hidden-hand-card";
    replay.checkpoints[0].stateHash = "tampered";

    const verification = inspectTcgaCanonicalReplay(input, replay);
    expect(verification.privacyIssues).toContain("raw_source_identifier");
    expect(verification.integrityIssues).toContain("invalid_checkpoint");
    expect(verification.integrityIssues).toContain("checkpoint_projection_mismatch");
  });
});

function productFixture(match: NonNullable<TcgaReplayRawCaptureV1["capture"]["match"]>): TcgaReplayRawCaptureV1 {
  const input = fixture();
  input.capture.source.schema = "riftlite-tcga-web-replay";
  input.capture.match = match;
  return input;
}

function fixture(): TcgaReplayRawCaptureV1 {
  const messages: TcgaReplayRawMessageV1[] = [
    message(0, 1_000, "in", {
      type: "NEWCOMMER_GAMEDATA",
      payload: {
        players: {
          "provider-self-secret": player("self", 0),
          "provider-opponent-secret": player("opponent", 0),
        },
        // TCGA bootstraps this at one before setup begins. It must not skip
        // the observable battlefield-selection phase.
        general: { turnCount: 1, stackOrder: [] },
      },
    }),
    message(1, 1_100, "out", {
      type: "PLAYER_DATA",
      gameId: "provider-self-secret",
      payload: player("self", 1),
    }),
    message(2, 1_200, "in", {
      type: "PLAYER_DATA",
      gameId: "provider-opponent-secret",
      payload: player("opponent", 1),
    }),
    message(3, 1_300, "out", {
      type: "GAME_DATA",
      gameId: "provider-self-secret",
      payload: {
        currentPlayer: "provider-self-secret",
      },
    }),
    message(4, 1_350, "out", {
      type: "GAME_DATA",
      gameId: "provider-self-secret",
      payload: {
        playerData: player("self", 4),
        newToHistory: {
          id: "provider-history-mulligan",
          playerId: "provider-self-secret",
          text: "play.logs.game.mulligan.complete",
        },
      },
    }),
    message(5, 1_400, "out", {
      type: "GAME_DATA",
      gameId: "provider-self-secret",
      payload: { playerData: player("self", 10), turnCount: 1 },
    }),
    message(6, 1_500, "in", {
      type: "GAME_DATA",
      gameId: "provider-opponent-secret",
      payload: {
        playerData: player("opponent", 10, true),
        gameOptions: { startingPlayer: { randomId: "provider-self-secret", id: "wrong-provider-id" } },
      },
    }),
    message(7, 2_000, "out", {
      type: "GAME_DATA",
      gameId: "provider-self-secret",
      payload: {
        turnCount: 2,
        currentPlayer: "provider-opponent-secret",
        newToHistory: {
          id: "provider-history-turn",
          playerId: "provider-opponent-secret",
          text: "play.logs.game.turnStarted",
        },
      },
    }),
    message(8, 2_100, "out", {
      type: "LEAVING",
      gameId: "provider-self-secret",
      payload: {},
    }),
  ];
  return {
    schema: "riftlite-tcga-raw-capture",
    version: 1,
    exportedAt: "2026-07-20T15:00:00.000Z",
    capture: {
      captureSessionId: "provider-capture-secret",
      identity: {
        perspectivePlayerId: "provider-self-secret",
        firstSeenAt: 1_000,
        lastSeenAt: 2_100,
      },
      lifecycle: {
        channelKey: "provider-channel-secret",
        openedAt: 900,
        closedAt: 2_100,
        endedByLeaving: true,
      },
      source: {
        schema: "riftlite-tcga-research-session",
        version: 1,
        sha256: "a".repeat(64),
      },
    },
    transport: {
      frames: messages.length,
      decodedFrames: messages.length,
      logicalMessages: messages.length,
      chunkGroups: 0,
      completeChunkGroups: 0,
      incompleteChunkGroups: 0,
      incompleteChunkCount: 0,
      duplicateChunks: 0,
      issueCounts: {},
    },
    messages,
  };
}

function mulliganDeckFixture(
  variant: "ambiguous" | "boundary_reversed" | "exact",
): TcgaReplayRawCaptureV1 {
  const owner = "provider-self-secret";
  const hidden = {
    status: "yes",
    "provider-self-secret": true,
    "provider-opponent-secret": true,
  };
  const deckCard = (id: string, name: string, code: string) => card(id, owner, "Deck", name, code, hidden);
  const cards = {
    headA: deckCard("deck-head-a", "Cull the Weak", "OGN-131"),
    headB: deckCard("deck-head-b", "Daring Poro", "OGN-135"),
    fillerA: deckCard("deck-filler-a", "Rampage", "VEN-083"),
    fillerB: deckCard("deck-filler-b", "Dragon Form", "VEN-116"),
    outA: deckCard("deck-out-a", "Aurok General", "VEN-130"),
    keptA: deckCard("deck-kept-a", "Ruin Runner", "SFD-105"),
    keptB: deckCard("deck-kept-b", "Kayle, Justified", "VEN-134"),
    outB: deckCard("deck-out-b", "Challenge", "OGN-128"),
    newA: deckCard("deck-new-a", "Sabotage", "OGN-156"),
    newB: deckCard("deck-new-b", "Repulse", "UNL-106"),
  };
  const preDeck = variant === "ambiguous"
    ? [cards.keptA, cards.newA, cards.outA, cards.outB, cards.keptB, cards.newB, cards.fillerA, cards.fillerB]
    : [
      cards.headA,
      cards.headB,
      cards.fillerA,
      cards.fillerB,
      cards.newA,
      cards.newB,
      cards.outA,
      cards.keptA,
      cards.keptB,
      cards.outB,
    ];
  const drawn = variant === "ambiguous"
    ? [cards.keptA, cards.newA, cards.keptB, cards.newB]
    : [cards.keptA, cards.keptB, cards.newA, cards.newB];
  const postDeck = variant === "ambiguous"
    ? [cards.fillerA, cards.fillerB, cards.outA, cards.outB]
    : variant === "boundary_reversed"
      ? [cards.outB, cards.outA, cards.headA, cards.headB, cards.fillerB, cards.fillerA]
      : [cards.outA, cards.outB, cards.headA, cards.headB, cards.fillerB, cards.fillerA];
  const selfSetup = (setupStep: number, deck: JsonObject[], handSection: "Deck" | "Hand" | null) => {
    const value = player("self", setupStep);
    value.deck = deck;
    value.visibleCards = (value.visibleCards as JsonObject[])
      .filter((entry) => entry.id !== "provider-local-hand-card");
    if (handSection) {
      value.visibleCards = [
        ...(value.visibleCards as JsonObject[]),
        ...drawn.map((entry) => ({
          ...entry,
          position: { section: handSection, index: 0 },
          hiddenTo: handSection === "Hand"
            ? { status: "opponent-only", "provider-opponent-secret": true }
            : entry.hiddenTo,
        })),
      ];
    }
    return value;
  };
  const opponentSetup = player("opponent", 4);
  const messages: TcgaReplayRawMessageV1[] = [
    message(0, 1_000, "out", {
      type: "PLAYER_DATA",
      gameId: owner,
      payload: selfSetup(3, preDeck, null),
    }),
    message(1, 1_050, "in", {
      type: "PLAYER_DATA",
      gameId: "provider-opponent-secret",
      payload: opponentSetup,
    }),
    message(2, 1_100, "out", {
      type: "GAME_DATA",
      gameId: owner,
      payload: {
        gameOptions: {
          format: { mulligan: { startingHandSize: 4 } },
          startingPlayer: { randomId: "provider-opponent-secret" },
        },
      },
    }),
    message(3, 1_200, "out", {
      type: "GAME_DATA",
      gameId: owner,
      payload: {
        newToHistory: {
          id: "mulligan-redraw-history",
          playerId: owner,
          text: "play.logs.game.mulligan.drawAgainX",
          params: { count: 2 },
        },
      },
    }),
    message(4, 1_300, "out", {
      type: "GAME_DATA",
      gameId: owner,
      payload: { playerData: selfSetup(4, postDeck, "Deck") },
    }),
    message(5, 1_400, "out", {
      type: "GAME_DATA",
      gameId: owner,
      payload: { playerData: selfSetup(10, postDeck, "Hand") },
    }),
    message(6, 1_500, "in", {
      type: "GAME_DATA",
      gameId: "provider-opponent-secret",
      payload: { playerData: player("opponent", 10) },
    }),
    message(7, 1_600, "out", {
      type: "LEAVING",
      gameId: owner,
      payload: {},
    }),
  ];
  const base = fixture();
  base.capture.identity.firstSeenAt = 1_000;
  base.capture.identity.lastSeenAt = 1_600;
  base.capture.lifecycle.openedAt = 900;
  base.capture.lifecycle.closedAt = 1_600;
  base.messages = messages;
  base.transport.frames = messages.length;
  base.transport.decodedFrames = messages.length;
  base.transport.logicalMessages = messages.length;
  return base;
}

function player(side: "self" | "opponent", setupStep: number, transientUnit = false): JsonObject {
  const self = side === "self";
  const owner = self ? "provider-self-secret" : "provider-opponent-secret";
  const hiddenToSelf = { status: "yes", "provider-self-secret": true };
  const publicToAll = { status: "no" };
  return {
    setupStep,
    turnOrderPosition: self ? 0 : 1,
    profileData: { username: self ? "Local Tester" : "Remote Tester" },
    playerCounters: [{ value: 7 }],
    visibleCards: [
      card(`${side}-legend`, owner, "Legend", self ? "Akali, Rogue Assassin" : "Irelia, Blade Dancer", self ? "OGN-001" : "OGN-002", publicToAll),
      card(`${side}-champion`, owner, "Chosen_Champion", self ? "Akali, Silent Death" : "Irelia, The Blade Dancer", self ? "OGN-003" : "OGN-004", publicToAll),
      ...(setupStep > 0 ? [
        card(`${side}-battlefield`, owner, "Battlefields", self ? "The Candlelit Sanctum" : "Navori Fighting Pit", self ? "OGN-291" : "OGN-283", publicToAll),
      ] : []),
      card(`${side}-unit`, owner, transientUnit ? false : "B1", self ? "Local Unit" : "Opponent Unit", self ? "OGN-010" : "OGN-011", publicToAll),
      ...(self ? [
        card("provider-local-hand-card", owner, "Hand", "Local Visible Hand", "OGN-012", publicToAll),
      ] : [
        card("provider-hidden-hand-card", owner, "Hand", "Opponent Hidden Hand Secret", "OGN-013", hiddenToSelf),
        card("provider-sideboard-card", owner, "Sideboard", "Opponent Sideboard Leak", "OGN-014", publicToAll),
        card("provider-hidden-exile-card", owner, "ExileHidden", "Opponent Hidden Exile Secret", "OGN-016", publicToAll),
      ]),
    ],
    deck: [card(`${side}-deck-card`, owner, "Deck", self ? "Local Ordered Deck Secret" : "Remote Ordered Deck Secret", "OGN-015", publicToAll)],
  };
}

function groupedOpponentPlayer(section: string, counters: JsonObject[]): JsonObject {
  const state = player("opponent", 10);
  const visibleCards = state.visibleCards as JsonObject[];
  const host = visibleCards.find((entry) => entry.id === "opponent-unit");
  if (!host) throw new Error("Missing opponent unit fixture card");
  host.position = { section, index: 0 };
  host.counters = counters;
  const attachment = card(
    "opponent-guardian-angel",
    "provider-opponent-secret",
    false,
    "Guardian Angel",
    "OGN-100",
    { status: "no" },
  );
  attachment.grouppedToId = "opponent-unit";
  attachment.counters = [{}, {}];
  state.visibleCards = [...visibleCards, attachment];
  return state;
}

function card(
  id: string,
  owner: string,
  section: string | false,
  name: string,
  code: string,
  hiddenTo: JsonObject,
): JsonObject {
  return {
    id,
    owner,
    position: { section, index: 0 },
    hiddenTo,
    cardData: { id: code, name: { en: name } },
    isTapped: false,
  };
}

function message(
  seq: number,
  ts: number,
  dir: "in" | "out",
  parsed: TcgaReplayRawMessageV1["parsed"],
): TcgaReplayRawMessageV1 {
  return {
    seq,
    ts,
    dir,
    firstTransportSequence: seq + 1,
    completedTransportSequence: seq + 1,
    parsed,
  };
}
