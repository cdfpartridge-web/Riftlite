import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
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

if (!HTMLElement.prototype.animate) {
  HTMLElement.prototype.animate = () => ({ pause() {}, play() {} } as Animation);
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

  it("hydrates opener art, keeps its shade mounted, and reveals the selected landscape battlefields", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    const sceneCodes = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-scene-content] [data-card-code]"),
      (element) => element.dataset.cardCode,
    );
    expect(sceneCodes).toEqual(expect.arrayContaining(["UNL-199", "UNL-172", "SFD-251", "OGN-232"]));
    expect(view.container.querySelector('[aria-label$=" runes"]')).not.toBeInTheDocument();

    const shade = view.container.querySelector("[data-scene-shade]");
    expect(shade).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Next action" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="battlefields"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector("[data-scene-shade]")).toBe(shade);
    const battlefieldCards = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-scene-content] [data-battlefield-card]"),
    );
    expect(battlefieldCards).toHaveLength(2);
    expect(battlefieldCards.map((element) => element.dataset.cardCode)).toEqual(["OGN-297", "SFD-218"]);
    expect(battlefieldCards.every((element) => Boolean(element.querySelector("img")))).toBe(true);
  });

  it("renders real rune cards and explicit duplicate markers without the old rune counter", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-rune-rail]")).toHaveLength(2);
    });

    expect(view.container.querySelectorAll("[data-rune-card]")).toHaveLength(2);
    expect(view.container.querySelectorAll("[data-rune-slot]")).toHaveLength(22);
    expect(view.container.querySelectorAll('[data-rune-deck-count="11"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-rune-card][data-card-exhausted="true"]')).toHaveLength(1);
    expect(view.container.querySelector('[aria-label$=" runes"]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-card-duplicate="true"]')).toHaveTextContent("Duplicate");
    expect(Array.from(view.container.querySelectorAll<HTMLElement>("[data-player-score]"), (element) => (
      element.dataset.playerScore
    ))).toEqual(["5", "7"]);
  });

  it("shows selected battlefield scans in a landscape inspector frame", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-battlefield-zone="battlefieldA"] [data-battlefield-card]'))
        .toBeInTheDocument();
    });
    const battlefield = view.container.querySelector<HTMLElement>(
      '[data-battlefield-zone="battlefieldA"] [data-battlefield-card]',
    );
    expect(battlefield).not.toBeNull();
    fireEvent.mouseEnter(battlefield!);

    await waitFor(() => {
      expect(view.container.querySelector('[data-inspector-battlefield="true"]')).toBeInTheDocument();
    });
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
        score: 7,
        fields: { selectedBattlefield: "Windswept Hillock" },
        boardFields: {},
        zones: {
          base: [{
            ...replayCard("self-duplicate", "Ruined Rex", "UNL-067", "mainDeck"),
            fields: {
              cardCode: "UNL-067",
              isDuplicate: true,
              name: "Ruined Rex",
              source: "mainDeck",
            },
          }],
          champion: [replayCard("self-champion", "LeBlanc, Fragmented", "UNL-172", "champion")],
          legend: [replayCard("self-legend", "LeBlanc, Deceiver", "UNL-199", "legend")],
          runeArea: [{
            ...replayCard("self-rune", "Order Rune", "OGN-214", "rune"),
            exhausted: true,
            fields: {
              cardCode: "OGN-214",
              exhausted: true,
              name: "Order Rune",
              source: "rune",
            },
          }],
          runeDeck: Array.from({ length: 11 }, (_, index) => hiddenRune(`self-rune-deck-${index}`)),
        },
      },
      opponent: {
        id: "opponent",
        name: "Fiora",
        score: 5,
        fields: { selectedBattlefield: "Sunken Temple" },
        boardFields: {},
        zones: {
          champion: [replayCard("opponent-champion", "Fiora, Victorious", "OGN-232", "champion")],
          legend: [replayCard("opponent-legend", "Fiora, Grand Duelist", "SFD-251", "legend")],
          runeArea: [replayCard("opponent-rune", "Body Rune", "OGN-126", "rune")],
          runeDeck: Array.from({ length: 11 }, (_, index) => hiddenRune(`opponent-rune-deck-${index}`)),
        },
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

function replayCard(id: string, name: string, cardCode: string, source: string) {
  return {
    id,
    name,
    cardCode,
    source,
    fields: { cardCode, name, source },
  };
}

function hiddenRune(id: string) {
  return {
    id,
    name: "Hidden rune",
    isPlaceholder: true,
    source: "runeDeck",
    fields: { isPlaceholder: true, source: "runeDeck" },
  };
}
