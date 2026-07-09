import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CanonicalReplayV2 } from "@/lib/replay-v2";

vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
}));

vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { ReplayV2Player, replayGamePlaybackStartMs } from "./ReplayV2Player";

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

describe("ReplayV2Player presentation prelude", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay: sideboardingAtZeroReplay() }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens paused on Matchup even when sideboarding is the last canonical event at zero", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(view.queryByText("Sideboarding")).not.toBeInTheDocument();
  });

  it("shows a truthful processing state for a 202 replay summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: { status: "processing" },
    }), {
      headers: { "content-type": "application/json" },
      status: 202,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rl2_processing" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Replay processing" })).toBeInTheDocument();
    });
    expect(view.getByText(/retry automatically/i)).toBeInTheDocument();
    expect(view.queryByText(/has not been normalized/i)).not.toBeInTheDocument();
    view.unmount();
  });

  it("surfaces an owner-visible failure from a 202 replay summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: {
        status: "failed",
        failure: { message: "The capture could not be normalized." },
      },
    }), {
      headers: { "content-type": "application/json" },
      status: 202,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rl2_failed" }));

    await waitFor(() => {
      expect(view.getByText("The capture could not be normalized.")).toBeInTheDocument();
    });
    expect(view.getByRole("heading", { name: "Replay unavailable" })).toBeInTheDocument();
  });

  it("enters gameplay after the virtual prelude instead of replaying setup phases", () => {
    const game = sideboardingAtZeroReplay().series.games[0];
    game.phases.push({
      phase: "in_game",
      rawPhase: "in_game",
      startEventIndex: 2,
      endEventIndex: 2,
      startedAtMs: 640,
      endedAtMs: 1_000,
    });
    expect(replayGamePlaybackStartMs(game)).toBe(640);
  });
});

function sideboardingAtZeroReplay(): CanonicalReplayV2 {
  const snapshot = {
    room: {
      phase: "sideboarding" as const,
      rawPhase: "sideboarding",
      gameNumber: 1,
      fields: {},
    },
    players: {
      self: {
        id: "self",
        name: "LeBlanc",
        fields: {},
        boardFields: {},
        zones: {},
      },
      opponent: {
        id: "opponent",
        name: "Fiora",
        fields: {},
        boardFields: {},
        zones: {},
      },
    },
    chain: [],
    log: [],
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "rp_test",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture-test",
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      messageCount: 1,
    },
    series: {
      id: "series-test",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      participants: [
        { id: "self", name: "LeBlanc", isPerspective: true, fields: {} },
        { id: "opponent", name: "Fiora", isPerspective: false, fields: {} },
      ],
      games: [{
        id: "game-1",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["instance-1"] },
        startedAt: 1_000,
        endedAt: 2_000,
        startedAtMs: 0,
        endedAtMs: 1_000,
        eventStartIndex: 0,
        eventEndIndex: 2,
        phases: [{
          phase: "sideboarding",
          rawPhase: "sideboarding",
          startEventIndex: 1,
          endEventIndex: 2,
          startedAtMs: 0,
          endedAtMs: 0,
        }],
      }],
    },
    events: [
      {
        id: "event-boundary",
        index: 0,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "game_boundary",
        boundary: "start",
        gameOrdinal: 1,
        gameNumber: 1,
        reason: "series_start",
      },
      {
        id: "event-phase",
        index: 1,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "phase",
        phase: "sideboarding",
        rawPhase: "sideboarding",
        gameNumber: 1,
      },
      {
        id: "event-snapshot",
        index: 2,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "snapshot",
        snapshot,
      },
    ],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}
