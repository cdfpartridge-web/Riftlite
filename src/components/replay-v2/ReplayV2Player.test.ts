import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  projectReplayState,
  type CanonicalReplayV2,
} from "@/lib/replay-v2";

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

  it("keeps the opponent hand hidden in a normal perspective replay", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_private_hand" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-player-id="opponent"] [data-hand-cards]'))
        .toBeInTheDocument();
    });
    const opponentHand = view.container.querySelector<HTMLElement>(
      '[data-player-id="opponent"] [data-hand-cards]',
    );
    expect(opponentHand?.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Hidden card");
    expect(opponentHand?.querySelector("[data-card-code]")).not.toBeInTheDocument();
    expect(view.container.querySelector("[data-combined-replay]")).not.toBeInTheDocument();
  });

  it("reveals both real hands across the board, opening, and mulligan in a consented combined replay", async () => {
    const replay = asConsentedCombinedReplay(mulliganReplay());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_combined_hands" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-combined-replay="open-hands"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-combined-replay="open-hands"]'))
      .toHaveTextContent("Combined replay · Open hands");
    const opponentBoardHand = view.container.querySelector<HTMLElement>(
      '[data-player-id="opponent"] [data-hand-cards]',
    );
    expect(opponentBoardHand?.querySelector('[data-card-id="opponent-mulligan-a"]'))
      .toHaveAccessibleName("Eager Apprentice");
    expect(opponentBoardHand?.querySelector('[data-card-hidden-at-battlefield="true"]'))
      .not.toBeInTheDocument();
    expect(opponentBoardHand?.querySelector('[data-card-code="OGN-031"]')).toBeInTheDocument();

    for (const scene of ["battlefields", "initiative", "opening"]) {
      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => {
        expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument();
      });
    }
    const opening = view.container.querySelector<HTMLElement>('[data-scene="opening"]');
    expect(opening?.querySelector('[data-card-id="opponent-mulligan-a"]'))
      .toHaveAccessibleName("Eager Apprentice");

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="mulligan"]')).toBeInTheDocument();
    });
    const opponentMulligan = view.container.querySelector<HTMLElement>(
      '[data-mulligan-player="opponent"]',
    );
    expect(opponentMulligan?.querySelector('[data-card-code="OGN-031"]')).toBeInTheDocument();
    expect(opponentMulligan?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(0);
  });

  it("labels only an unrevealed Atlas hidden card while it is at a battlefield", async () => {
    const replay = sideboardingAtZeroReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");

    const selfBattlefieldCard = snapshot.snapshot.players.self.zones.battlefieldB[0];
    selfBattlefieldCard.fields.hidden = true;
    const revealedOpponentCard = snapshot.snapshot.players.opponent.zones.battlefieldA[0];
    revealedOpponentCard.fields.hidden = true;
    revealedOpponentCard.fields.revealedToOpponent = true;
    snapshot.snapshot.players.self.zones.hand[0].fields.hidden = true;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_atlas_hidden" }));

    const hiddenBattlefieldCard = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-card-id="self-battlefield-unit"]',
      );
      expect(element).toBeInTheDocument();
      return element!;
    });
    expect(hiddenBattlefieldCard).toHaveAttribute("data-card-hidden-at-battlefield", "true");
    expect(hiddenBattlefieldCard).toHaveAccessibleName("Black Rose Dignitary, hidden at battlefield");
    expect(hiddenBattlefieldCard).toHaveTextContent("Hidden");
    expect(view.container.querySelector('[data-card-id="opponent-battlefield-unit"]'))
      .not.toHaveAttribute("data-card-hidden-at-battlefield");
    expect(view.container.querySelector('[data-card-id="self-hand"]'))
      .not.toHaveAttribute("data-card-hidden-at-battlefield");
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

  it("stages known mulligan cards leaving before their replacements enter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_mulligan" }));

    await advanceToMulligan(view);

    const selfHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="self"]');
    expect(selfHand).not.toBeNull();
    expect(selfHand).toHaveAttribute("data-mulligan-details", "exact");
    expect(selfHand).toHaveTextContent("1 card replaced");
    expect(selfHand?.querySelector(
      '[data-mulligan-card="leaving"] [data-card-id="self-mulligan-out"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-id="self-mulligan-in"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="kept"] [data-card-id="self-mulligan-kept"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"]')).toHaveTextContent("Out");
    expect(selfHand?.querySelector('[data-mulligan-card="entering"]')).toHaveTextContent("New");
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"]')).toHaveAttribute("aria-hidden", "true");
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"] button')).toHaveAttribute("tabindex", "-1");
    expect(selfHand?.querySelector('[data-mulligan-card="entering"] button')).toHaveAttribute("tabindex", "-1");
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-code="UNL-152"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-id="self-opening-fifth"]',
    )).not.toBeInTheDocument();

    const opponentHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="opponent"]');
    expect(opponentHand).toHaveAttribute("data-mulligan-details", "exact");
    expect(opponentHand).toHaveTextContent("Opening hand kept");
    expect(opponentHand?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(2);
  });

  it("uses count-only card-back motion when opponent mulligan identities are hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay({ opponentRedrawCount: 2 }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_hidden_mulligan" }));

    await advanceToMulligan(view);

    const opponentHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="opponent"]');
    expect(opponentHand).toHaveAttribute("data-mulligan-details", "count");
    expect(opponentHand).toHaveTextContent("2 cards replaced");
    expect(opponentHand?.querySelectorAll('[data-mulligan-card="leaving"]')).toHaveLength(2);
    expect(opponentHand?.querySelectorAll('[data-mulligan-card="entering"]')).toHaveLength(2);
    expect(opponentHand?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(4);
    expect(opponentHand).not.toHaveTextContent("Replacement details unavailable");
  });

  it("scales mulligan motion with the selected replay speed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_fast_mulligan" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-control="speed"]')).toBeInTheDocument();
    });
    const speedControl = view.container.querySelector<HTMLButtonElement>('[data-control="speed"]');
    fireEvent.click(speedControl!);
    fireEvent.click(speedControl!);
    expect(speedControl).toHaveTextContent("4×");

    await advanceToMulligan(view);

    const selfHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="self"]');
    expect(selfHand?.style.getPropertyValue("--mulligan-duration")).toBe("512.5ms");
    expect(selfHand?.style.getPropertyValue("--mulligan-short-duration")).toBe("387.5ms");
    const secondSlot = selfHand?.querySelectorAll<HTMLElement>("[data-mulligan-slot]")[1];
    expect(secondSlot?.style.getPropertyValue("--mulligan-delay")).toBe("18.75ms");
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

  it("renders projected labels and counters and groups non-adjacent equipment under its host", async () => {
    const replay = sideboardingAtZeroReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");

    const host = {
      ...replayCard("card_host", "Akali", "OGN-001", "mainDeck"),
      fields: {
        cardCode: "OGN-001",
        customLabels: ["Empowered", ""],
        name: "Akali",
        redCounter: -4,
        source: "mainDeck",
        whiteCounter: 0,
      },
    };
    const guardianAngel = {
      ...replayCard("card_guardian", "Guardian Angel", "OGN-002", "mainDeck"),
      fields: {
        attachedToCardId: host.id,
        cardCode: "OGN-002",
        name: "Guardian Angel",
        source: "mainDeck",
      },
    };
    const longSword = {
      ...replayCard("card_sword", "Long Sword", "OGN-003", "mainDeck"),
      fields: {
        attachedToCardId: host.id,
        cardCode: "OGN-003",
        name: "Long Sword",
        source: "mainDeck",
      },
    };
    const unrelated = replayCard("card_other", "Stellacorn Herder", "OGN-004", "mainDeck");
    // Mirrors the observed replay: an attachment can precede its host and an
    // unrelated card can sit between them because zone reorder is not projected.
    snapshot.snapshot.players.self.zones.base = [guardianAngel, unrelated, host, longSword];
    snapshot.snapshot.players.opponent.zones.hand[0].fields = {
      ...snapshot.snapshot.players.opponent.zones.hand[0].fields,
      customLabels: ["Secret"],
      redCounter: -4,
      whiteCounter: 0,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    const view = render(createElement(ReplayV2Player, { replayId: "rp_card_polish" }));
    const group = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-card-attachment-group="card_host"]',
      );
      expect(element).toBeInTheDocument();
      return element!;
    });

    expect(group).toHaveAttribute("data-attachment-count", "2");
    expect(group.style.getPropertyValue("--attachment-count")).toBe("2");
    expect(group.querySelector('[data-card-attachment-layer="host"] [data-card-id="card_host"]'))
      .toBeInTheDocument();
    const attachmentLayers = Array.from(
      group.querySelectorAll<HTMLElement>('[data-card-attachment-layer="attachment"]'),
    );
    expect(attachmentLayers).toHaveLength(2);
    expect(attachmentLayers.map((layer) => layer.style.getPropertyValue("--attachment-index")))
      .toEqual(["0", "1"]);
    expect(group.querySelector('[data-card-id="card_guardian"]'))
      .toHaveAttribute("data-card-attached-to", "card_host");
    expect(group.querySelector('[data-card-id="card_sword"]'))
      .toHaveAttribute("data-card-attached-to", "card_host");
    expect(view.container.querySelectorAll('[data-card-id="card_host"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-card-id="card_guardian"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-card-id="card_other"]')).toBeInTheDocument();
    const faceDownOpponentCard = view.container.querySelector<HTMLElement>(
      '[data-card-id="opponent-hand"]',
    );
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-label-count");
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-white-counter");
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-red-counter");
    expect(faceDownOpponentCard?.querySelector("[data-card-custom-label]")).not.toBeInTheDocument();
    expect(faceDownOpponentCard?.querySelector("[data-card-counter]")).not.toBeInTheDocument();

    const hostTile = group.querySelector<HTMLElement>('[data-card-id="card_host"]');
    expect(hostTile).toHaveAttribute("data-card-label-count", "1");
    expect(hostTile).toHaveAttribute("data-card-white-counter", "0");
    expect(hostTile).toHaveAttribute("data-card-red-counter", "-4");
    expect(hostTile?.querySelector('[data-card-custom-label="Empowered"]')).toHaveTextContent("Empowered");
    expect(hostTile?.querySelector('[data-card-counter="white"]')).toHaveTextContent("0");
    expect(hostTile?.querySelector('[data-card-counter="red"]')).toHaveTextContent("-4");

    fireEvent.mouseEnter(hostTile!);
    await waitFor(() => {
      expect(view.container.querySelector('[data-hover-card-custom-label="Empowered"]'))
        .toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-hover-card-counter="white"]')).toHaveTextContent("0");
    expect(view.container.querySelector('[data-hover-card-counter="red"]')).toHaveTextContent("-4");

    const attachedTile = group.querySelector<HTMLElement>('[data-card-id="card_guardian"]');
    fireEvent.mouseEnter(attachedTile!);
    expect(view.container.querySelector('[data-hover-card-name="Guardian Angel"]')).toBeInTheDocument();
    fireEvent.click(attachedTile!);
    fireEvent.mouseLeave(attachedTile!);
    await waitFor(() => {
      expect(view.container.querySelector("[data-card-inspector] h2")).toHaveTextContent("Guardian Angel");
    });
  });

  it("keeps each rune rail adjacent to its hand instead of overlaying it", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-hand-layout]")).toHaveLength(2);
    });
    for (const player of view.container.querySelectorAll<HTMLElement>("[data-player-id]")) {
      const handRow = player.querySelector("[data-hand-row]");
      const runeRail = player.querySelector("[data-rune-rail]");
      expect(handRow).toBeInTheDocument();
      expect(runeRail).toBeInTheDocument();
      expect(handRow?.parentElement).toBe(runeRail?.parentElement);
    }
    expect(view.container.querySelectorAll('[data-card-size="hand"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-card-size="board"]').length).toBeGreaterThanOrEqual(3);
    expect(view.container.querySelectorAll('[data-card-size="rune"]')).toHaveLength(2);
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
    expect(view.container.querySelector('[data-hover-card-preview][data-hover-battlefield="true"]'))
      .toBeInTheDocument();
    expect(view.container.querySelector("[data-card-inspector]")).toBeInTheDocument();
    expect(view.container.querySelector("[data-inspector-art-frame]")).toBeInTheDocument();
    expect(view.container.querySelector("[data-activity-panel]")).toBeInTheDocument();
  });

  it("shows a large transient preview for board and hero cards only while hovered", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    const handCard = await view.findByRole("button", { name: "Harnessed Dragon" });
    fireEvent.mouseEnter(handCard);
    expect(view.container.querySelector('[data-hover-card-name="Harnessed Dragon"]'))
      .toBeInTheDocument();

    fireEvent.mouseLeave(handCard);
    await waitFor(() => {
      expect(view.container.querySelector("[data-hover-card-preview]")).not.toBeInTheDocument();
    });

    const heroStack = view.container.querySelector('[data-hero-stack="bottom"]');
    const champion = heroStack?.querySelector<HTMLElement>('[aria-label="LeBlanc, Fragmented"]');
    expect(champion).not.toBeNull();
    fireEvent.mouseEnter(champion!);
    expect(view.container.querySelector('[data-hover-card-name="LeBlanc, Fragmented"]'))
      .toBeInTheDocument();
  });

  it("removes a played champion from its visual slot without losing opener identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: sideboardingAtZeroReplay({ championPlayed: true }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    const heroStack = view.container.querySelector('[data-hero-stack="bottom"]');
    expect(heroStack?.querySelector('[aria-label="LeBlanc, Fragmented"]')).not.toBeInTheDocument();
    expect(heroStack).toHaveTextContent("Champion");
    expect(view.container.querySelector(
      '[data-player-id="self"] [aria-label="LeBlanc, Fragmented"]',
    )).toBeInTheDocument();
    expect(view.container.querySelector(
      '[data-scene-content] [data-card-code="UNL-172"]',
    )).toBeInTheDocument();
  });

  it("shows the large card preview while browsing trash and clears it on close", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: sideboardingAtZeroReplay({ includeTrash: true }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    const openTrash = await view.findByRole("button", { name: "Open trash, 1 cards" });
    fireEvent.click(openTrash);
    const trashCard = await view.findByRole("button", { name: "Solari Soldier" });
    fireEvent.mouseEnter(trashCard);

    expect(view.container.querySelector('[data-hover-card-name="Solari Soldier"]'))
      .toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Close trash" }));
    expect(view.container.querySelector("[data-hover-card-preview]")).not.toBeInTheDocument();
  });

  it("pairs seat-one cards with the capture player's left battlefield", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-battlefield-zone]")).toHaveLength(2);
    });
    const lanes = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-battlefield-zone]"),
    );

    expect(lanes.map((lane) => ({
      battlefield: lane.dataset.battlefieldName,
      owner: lane.dataset.battlefieldOwner,
      zone: lane.dataset.battlefieldZone,
    }))).toEqual([
      { battlefield: "Windswept Hillock", owner: "self", zone: "battlefieldB" },
      { battlefield: "Sunken Temple", owner: "opponent", zone: "battlefieldA" },
    ]);
    expect(lanes[0].querySelector('[aria-label="Black Rose Dignitary"]')).toBeInTheDocument();
    expect(lanes[1].querySelector('[aria-label="Eager Drakehound"]')).toBeInTheDocument();
    expect(lanes[0].querySelector('[aria-label="Eager Drakehound"]')).not.toBeInTheDocument();
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

  it("anchors Game 2 sideboarding to the confirmed local submission and animates exact quantities", async () => {
    const replay = bo3SideboardingReplay({ includeResult: true });
    addLegacyGameTwoCheckpoint(replay);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay,
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_bo3_sideboard" }));

    await advanceToGameTwo(view);

    const transition = view.container.querySelector<HTMLElement>("[data-series-transition]");
    expect(transition).toHaveAttribute("data-series-score", "1-0");
    expect(transition).toHaveTextContent("Best of 3");
    expect(transition).toHaveTextContent("Game 2");
    expect(transition?.querySelector("[data-series-score-bottom]")).toHaveTextContent("1");
    expect(transition?.querySelector("[data-series-score-top]")).toHaveTextContent("0");

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="sideboarding"]')).toBeInTheDocument();
    });

    const scene = view.container.querySelector<HTMLElement>('[data-scene="sideboarding"]');
    const sideboard = scene?.querySelector<HTMLElement>("[data-sideboard-status]");
    expect(sideboard).toHaveAttribute("data-sideboard-status", "exact");
    expect(sideboard).toHaveAttribute("data-sideboard-action-index", "7");
    expect(sideboard?.querySelectorAll('[data-sideboard-card="out"]')).toHaveLength(2);
    expect(sideboard?.querySelectorAll('[data-sideboard-card="in"]')).toHaveLength(2);
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [data-card-code="OGN-010"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [aria-label="Name Only Out"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [data-card-code="OGN-020"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [aria-label="Name Only In"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [data-sideboard-quantity="2"]'))
      .toHaveTextContent("×2");
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [data-sideboard-quantity="2"]'))
      .toHaveTextContent("×2");
    expect(sideboard?.querySelector('[data-opponent-sideboard="locked"]')).toHaveTextContent(
      "Opponent sideboard choices stay hidden",
    );
    expect(view.container.querySelectorAll("[data-battlefield-card]")).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="battlefields"]')).toBeInTheDocument());
    const gameTwoBattlefields = Array.from(
      view.container.querySelectorAll<HTMLElement>('[data-scene="battlefields"] [data-battlefield-card]'),
    );
    expect(gameTwoBattlefields.map((element) => element.dataset.cardCode)).toEqual(["OGN-289", "UNL-215"]);
    expect(gameTwoBattlefields[0]).toHaveTextContent("Targon's Peak");
    expect(gameTwoBattlefields[0]).toHaveTextContent("LeBlanc");
    expect(gameTwoBattlefields[1]).toHaveTextContent("Star Spring");
    expect(gameTwoBattlefields[1]).toHaveTextContent("Fiora");
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="first_player"]')).toBeInTheDocument());
    expect(view.container.querySelector("[data-first-player-scene]")).toHaveTextContent("will take the first action");
    expect(view.queryByText("d20")).not.toBeInTheDocument();
  });

  it("shows both submitted sideboard changes in a consented combined replay", async () => {
    const replay = asConsentedCombinedReplay(bo3SideboardingReplay({ includeResult: true }));
    addOpponentSideboardDetails(replay);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_combined_sideboard" }));

    await advanceToGameTwo(view);
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="sideboarding"]')).toBeInTheDocument();
    });

    const sideboard = view.container.querySelector<HTMLElement>("[data-sideboard-status]");
    expect(sideboard).toHaveAttribute("data-sideboard-mode", "open-hands");
    expect(sideboard?.querySelector('[data-opponent-sideboard="locked"]')).not.toBeInTheDocument();
    const self = sideboard?.querySelector<HTMLElement>('[data-sideboard-player="LeBlanc"]');
    const opponent = sideboard?.querySelector<HTMLElement>('[data-sideboard-player="Fiora"]');
    expect(self).toHaveAttribute("data-sideboard-player-status", "exact");
    expect(opponent).toHaveAttribute("data-sideboard-player-status", "exact");
    expect(opponent).toHaveAttribute("data-sideboard-player-action-index", "6");
    expect(opponent?.querySelector('[data-sideboard-card="out"] [data-card-code="OGN-030"]'))
      .toBeInTheDocument();
    expect(opponent?.querySelector('[data-sideboard-card="in"] [data-card-code="OGN-040"]'))
      .toBeInTheDocument();
  });

  it("keeps BO3 identity visible without inventing a missing series score", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: bo3SideboardingReplay({ includeResult: false }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_bo3_no_result" }));

    await advanceToGameTwo(view);

    const transition = view.container.querySelector<HTMLElement>("[data-series-transition]");
    expect(transition).toHaveAttribute("data-series-score", "unknown");
    expect(transition).toHaveTextContent("Best of 3");
    expect(transition).toHaveTextContent("Game 2");
    expect(transition).toHaveTextContent("Series score unavailable");
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

function sideboardingAtZeroReplay(options: {
  championPlayed?: boolean;
  includeTrash?: boolean;
} = {}): CanonicalReplayV2 {
  const selfChampion = replayCard(
    "self-champion",
    "LeBlanc, Fragmented",
    "UNL-172",
    "champion",
  );
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
        seat: 1,
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
          }, ...(options.championPlayed ? [selfChampion] : [])],
          battlefieldB: [replayCard(
            "self-battlefield-unit",
            "Black Rose Dignitary",
            "UNL-152",
            "mainDeck",
          )],
          champion: options.championPlayed ? [] : [selfChampion],
          hand: [replayCard("self-hand", "Harnessed Dragon", "OGN-015", "mainDeck")],
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
          trash: options.includeTrash
            ? [replayCard("self-trash", "Solari Soldier", "OGN-125", "mainDeck")]
            : [],
        },
      },
      opponent: {
        id: "opponent",
        name: "Fiora",
        seat: 0,
        score: 5,
        fields: { selectedBattlefield: "Sunken Temple" },
        boardFields: {},
        zones: {
          battlefieldA: [replayCard(
            "opponent-battlefield-unit",
            "Eager Drakehound",
            "SFD-006",
            "mainDeck",
          )],
          champion: [replayCard("opponent-champion", "Fiora, Victorious", "OGN-232", "champion")],
          hand: [replayCard("opponent-hand", "Eager Apprentice", "OGN-031", "mainDeck")],
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

function asConsentedCombinedReplay(replay: CanonicalReplayV2): CanonicalReplayV2 {
  replay.collaboration = {
    schema: "riftlite-dual-perspective",
    version: 1,
    mode: "dual-perspective",
    sourceReplayIds: ["source-self", "source-opponent"],
    sourceCanonicalSha256s: ["a".repeat(64), "b".repeat(64)],
    perspectivePlayerIds: ["self", "opponent"],
    informationPolicy: "consented_full_information",
    confidence: "exact",
    diagnostics: {
      primarySourceReplayId: "source-self",
      pairedSnapshotEvents: 1,
      pairedActionEvents: 1,
      unpairedPrimaryEvents: 0,
      unpairedSecondaryEvents: 0,
      enrichedCards: 2,
      enrichedFields: 2,
      coveragePercent: 100,
      warningCodes: [],
    },
  };
  return replay;
}

async function advanceToMulligan(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
  });
  for (const scene of ["battlefields", "initiative", "opening", "mulligan"]) {
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument();
    });
  }
}

async function advanceToGameTwo(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
  });
  fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="game_transition"]')).toBeInTheDocument();
  }, { timeout: 2_500 });
}

function mulliganReplay(options: { opponentRedrawCount?: number } = {}): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const phaseEvent = replay.events[1];
  const snapshotEvent = replay.events[2];
  if (phaseEvent.kind !== "phase" || snapshotEvent.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its setup events.");
  }

  const opponentRedrawCount = options.opponentRedrawCount ?? 0;
  const selfKept = replayCard("self-mulligan-kept", "Harnessed Dragon", "OGN-015", "mainDeck");
  const selfLeaving = replayCard("self-mulligan-out", "Black Rose Dignitary", "UNL-152", "mainDeck");
  // A different instance of the same printed card is still a real replacement.
  const selfEntering = replayCard("self-mulligan-in", "Black Rose Dignitary", "UNL-152", "mainDeck");
  const selfOpeningFifth = replayCard("self-opening-fifth", "Soaring Scout", "OGN-020", "mainDeck");
  snapshotEvent.snapshot.room.phase = "mulligan";
  snapshotEvent.snapshot.room.rawPhase = "mulligan";
  snapshotEvent.snapshot.players.self.zones.hand = [selfKept, selfLeaving];
  snapshotEvent.snapshot.players.opponent.zones.hand = opponentRedrawCount
    ? [hiddenCard("opponent-mulligan-a"), hiddenCard("opponent-mulligan-b")]
    : [
        replayCard("opponent-mulligan-a", "Eager Apprentice", "OGN-031", "mainDeck"),
        replayCard("opponent-mulligan-b", "Eager Drakehound", "SFD-006", "mainDeck"),
      ];

  phaseEvent.phase = "mulligan";
  phaseEvent.rawPhase = "mulligan";
  replay.series.games[0].eventEndIndex = 5;
  replay.series.games[0].phases = [
    {
      phase: "mulligan",
      rawPhase: "mulligan",
      startEventIndex: 1,
      endEventIndex: 3,
      startedAtMs: 0,
      endedAtMs: 300,
    },
    {
      phase: "in_game",
      rawPhase: "in_game",
      startEventIndex: 4,
      endEventIndex: 5,
      startedAtMs: 350,
      endedAtMs: 350,
    },
  ];
  replay.events.push({
    id: "event-opponent-submit-mulligan",
    index: 3,
    at: 1_300,
    atMs: 300,
    sourceMessageId: "message-3",
    gameId: "game-1",
    kind: "action",
    actionType: "submit_mulligan",
    actorPlayerId: "opponent",
    action: opponentRedrawCount ? {} : { cardIds: [] },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-3",
    },
    patch: {
      sequence: 3,
      operations: [{
        id: "opponent-mulligan-playback",
        op: "set_room_fields",
        fields: {
          mulliganPlaybackByPlayerId: {
            opponent: { draws: [], redrawCount: opponentRedrawCount },
          },
        },
      }],
    },
  });
  replay.events.push({
    id: "event-in-game-phase",
    index: 4,
    at: 1_350,
    atMs: 350,
    sourceMessageId: "message-4",
    gameId: "game-1",
    kind: "phase",
    phase: "in_game",
    rawPhase: "in_game",
    gameNumber: 1,
  });
  replay.events.push({
    id: "event-self-submit-mulligan",
    index: 5,
    at: 1_350,
    atMs: 350,
    sourceMessageId: "message-4",
    gameId: "game-1",
    kind: "action",
    actionType: "submit_mulligan",
    actorPlayerId: "self",
    action: { cardIds: [selfLeaving.id] },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-4",
    },
    patch: {
      sequence: 4,
      operations: [
        {
          id: "self-mulligan-playback",
          op: "set_room_fields",
          fields: {
            mulliganPlaybackByPlayerId: {
              self: {
                draws: [
                  { cardId: selfEntering.id, kind: "refill" },
                  { cardId: selfOpeningFifth.id, kind: "opening" },
                ],
                redrawCount: 1,
              },
            },
          },
        },
        {
          id: "remove-mulligan-card",
          op: "zone_remove",
          playerId: "self",
          zone: "hand",
          cardIds: [selfLeaving.id],
        },
        {
          id: "draw-mulligan-card",
          op: "zone_insert",
          playerId: "self",
          zone: "hand",
          index: 1,
          cards: [selfEntering, selfOpeningFifth],
        },
      ],
    },
  });
  return replay;
}

function bo3SideboardingReplay(options: { includeResult: boolean }): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const sourceSnapshot = replay.events.find((event) => event.kind === "snapshot");
  if (!sourceSnapshot || sourceSnapshot.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its initial snapshot.");
  }
  const gameTwoSnapshot = structuredClone(sourceSnapshot.snapshot);
  gameTwoSnapshot.room.phase = "sideboarding";
  gameTwoSnapshot.room.rawPhase = "sideboarding";
  gameTwoSnapshot.room.gameNumber = 2;
  gameTwoSnapshot.room.firstPlayerId = "self";
  gameTwoSnapshot.players.self.fields = {
    ...gameTwoSnapshot.players.self.fields,
    submittedDeck: {
      sections: {
        mainDeck: [
          { cardCode: "OGN-001", count: 2, name: "Stable Card" },
          { cardCode: "OGN-010", count: 3, name: "Code Out" },
          { count: 1, name: "Name Only Out" },
        ],
        sideboard: [
          { cardCode: "OGN-020", count: 2, name: "Code In" },
          { count: 1, name: "Name Only In" },
        ],
      },
    },
  };
  const gameTwoRevealSnapshot = structuredClone(gameTwoSnapshot);
  gameTwoRevealSnapshot.room.phase = "in_game";
  gameTwoRevealSnapshot.room.rawPhase = "in_game";
  gameTwoRevealSnapshot.players.self.fields.selectedBattlefield = "Targon's Peak";
  gameTwoRevealSnapshot.players.opponent.fields.selectedBattlefield = "Star Spring";
  delete gameTwoRevealSnapshot.players.self.zones.battlefieldA;
  delete gameTwoRevealSnapshot.players.self.zones.battlefieldB;
  delete gameTwoRevealSnapshot.players.opponent.zones.battlefieldA;
  delete gameTwoRevealSnapshot.players.opponent.zones.battlefieldB;

  const gameOne = replay.series.games[0];
  gameOne.eventEndIndex = 2;
  if (options.includeResult) {
    gameOne.result = {
      resultEventId: "game-one-result",
      winnerPlayerId: "self",
      loserPlayerId: "opponent",
      finalScores: { self: 1, opponent: 0 },
    };
  } else {
    delete gameOne.result;
  }
  replay.series.format = "bo3";
  replay.series.bestOf = 3;
  replay.series.endedAt = 3_000;
  replay.series.games.push({
    id: "game-2",
    ordinal: 2,
    gameNumber: 2,
    sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["instance-2"] },
    startedAt: 2_000,
    endedAt: 3_000,
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    eventStartIndex: 3,
    eventEndIndex: 11,
    phases: [
      {
        phase: "sideboarding",
        rawPhase: "sideboarding",
        startEventIndex: 4,
        endEventIndex: 6,
        startedAtMs: 1_050,
        endedAtMs: 1_200,
      },
      {
        phase: "battlefield_pick",
        rawPhase: "battlefield_pick",
        startEventIndex: 8,
        endEventIndex: 8,
        startedAtMs: 1_400,
        endedAtMs: 1_400,
      },
      {
        phase: "first_player_choice",
        rawPhase: "first_player_choice",
        startEventIndex: 9,
        endEventIndex: 9,
        startedAtMs: 1_500,
        endedAtMs: 1_500,
      },
      {
        phase: "mulligan",
        rawPhase: "mulligan",
        startEventIndex: 10,
        endEventIndex: 10,
        startedAtMs: 1_600,
        endedAtMs: 1_600,
      },
      {
        phase: "in_game",
        rawPhase: "in_game",
        startEventIndex: 11,
        endEventIndex: 11,
        startedAtMs: 1_700,
        endedAtMs: 2_000,
      },
    ],
  });
  replay.source.endedAt = 3_000;
  replay.source.messageCount = 12;
  replay.events.push(
    {
      id: "game-two-boundary",
      index: 3,
      at: 2_000,
      atMs: 1_000,
      sourceMessageId: "message-game-two",
      gameId: "game-2",
      kind: "game_boundary",
      boundary: "start",
      gameOrdinal: 2,
      gameNumber: 2,
      reason: "explicit_game_number",
    },
    {
      id: "game-two-sideboard-phase",
      index: 4,
      at: 2_050,
      atMs: 1_050,
      sourceMessageId: "message-sideboard-phase",
      gameId: "game-2",
      kind: "phase",
      phase: "sideboarding",
      rawPhase: "sideboarding",
      gameNumber: 2,
    },
    {
      id: "game-two-snapshot",
      index: 5,
      at: 2_100,
      atMs: 1_100,
      sourceMessageId: "message-game-two-snapshot",
      gameId: "game-2",
      kind: "snapshot",
      snapshot: gameTwoSnapshot,
    },
    {
      id: "opponent-submit-sideboard",
      index: 6,
      at: 2_200,
      atMs: 1_200,
      sourceMessageId: "message-opponent-sideboard",
      gameId: "game-2",
      kind: "action",
      actionType: "submit_sideboard",
      actorPlayerId: "opponent",
      action: { type: "submit_sideboard" },
      confirmation: {
        status: "confirmed",
        authority: "authoritative_patch_commit",
        correlation: "matched_intent",
        commitMessageId: "message-opponent-sideboard",
      },
      patch: { sequence: 6, operations: [] },
    },
    {
      id: "self-submit-sideboard",
      index: 7,
      at: 2_300,
      atMs: 1_300,
      sourceMessageId: "message-self-sideboard",
      gameId: "game-2",
      kind: "action",
      actionType: "submit_sideboard",
      actorPlayerId: "self",
      action: {
        type: "submit_sideboard",
        mainDeck: [
          { cardCode: "OGN-001", count: 2, name: "Stable Card" },
          { cardCode: "OGN-010", count: 1, name: "Code Out" },
          { cardCode: "OGN-020", count: 2, name: "Code In" },
          { count: 1, name: "Name Only In" },
        ],
        sideboard: [
          { cardCode: "OGN-010", count: 2, name: "Code Out" },
          { count: 1, name: "Name Only Out" },
        ],
      },
      confirmation: {
        status: "confirmed",
        authority: "authoritative_patch_commit",
        correlation: "matched_intent",
        clientActionId: "self-sideboard-client-action",
        commitMessageId: "message-self-sideboard",
      },
      patch: { sequence: 7, operations: [] },
    },
    phaseEvent("battlefield_pick", 8, 2_400, 1_400),
    phaseEvent("first_player_choice", 9, 2_500, 1_500),
    phaseEvent("mulligan", 10, 2_600, 1_600),
    {
      id: "game-two-in-game-snapshot",
      index: 11,
      at: 2_700,
      atMs: 1_700,
      sourceMessageId: "message-in_game",
      gameId: "game-2",
      kind: "snapshot",
      snapshot: gameTwoRevealSnapshot,
    },
  );
  return replay;
}

function addOpponentSideboardDetails(replay: CanonicalReplayV2): void {
  const snapshot = replay.events.find((event) => event.id === "game-two-snapshot");
  const action = replay.events.find((event) => event.id === "opponent-submit-sideboard");
  if (!snapshot || snapshot.kind !== "snapshot" || !action || action.kind !== "action") {
    throw new Error("The replay fixture is missing opponent sideboard events.");
  }
  snapshot.snapshot.players.opponent.fields.submittedDeck = {
    sections: {
      mainDeck: [
        { cardCode: "OGN-001", count: 2, name: "Opponent Stable Card" },
        { cardCode: "OGN-030", count: 2, name: "Opponent Card Out" },
      ],
      sideboard: [
        { cardCode: "OGN-040", count: 1, name: "Opponent Card In" },
      ],
    },
  };
  action.action = {
    type: "submit_sideboard",
    mainDeck: [
      { cardCode: "OGN-001", count: 2, name: "Opponent Stable Card" },
      { cardCode: "OGN-030", count: 1, name: "Opponent Card Out" },
      { cardCode: "OGN-040", count: 1, name: "Opponent Card In" },
    ],
    sideboard: [
      { cardCode: "OGN-030", count: 1, name: "Opponent Card Out" },
    ],
  };
}

function addLegacyGameTwoCheckpoint(replay: CanonicalReplayV2) {
  const state = projectReplayState(replay, replay.series.games[0].eventEndIndex);
  state.gameId = "game-2";
  state.gameOrdinal = 2;
  state.phase = "battlefield_pick";
  state.room.phase = "battlefield_pick";
  state.room.rawPhase = "battlefield_pick";
  state.room.gameNumber = 2;
  state.room.firstPlayerId = "self";
  state.room.fields.selectedBattlefields = ["Windswept Hillock", "Sunken Temple"];
  state.players.self.fields.selectedBattlefield = "Windswept Hillock";
  state.players.self.fields.battlefieldOptions = ["Windswept Hillock", "Targon's Peak"];
  state.players.self.zones.battlefieldB = [replayCard("legacy-self-unit", "Black Rose Dignitary", "UNL-152", "mainDeck")];
  state.players.opponent.fields.selectedBattlefield = "Sunken Temple";
  state.players.opponent.fields.battlefieldOptions = ["Sunken Temple", "Star Spring"];
  state.players.opponent.zones.battlefieldA = [replayCard("legacy-opponent-unit", "Eager Drakehound", "SFD-006", "mainDeck")];
  state.appliedEventIndex = 7;
  replay.checkpoints = [{
    id: "legacy-game-two-checkpoint",
    eventIndex: 7,
    atMs: 1_300,
    stateHash: "legacy-stale-state",
    state,
  }];
}

function phaseEvent(
  phase: "battlefield_pick" | "first_player_choice" | "mulligan" | "in_game",
  index: number,
  at: number,
  atMs: number,
): CanonicalReplayV2["events"][number] {
  return {
    id: `game-two-${phase}`,
    index,
    at,
    atMs,
    sourceMessageId: `message-${phase}`,
    gameId: "game-2",
    kind: "phase",
    phase,
    rawPhase: phase,
    gameNumber: 2,
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

function hiddenCard(id: string) {
  return {
    id,
    name: "Hidden card",
    isPlaceholder: true,
    source: "hand",
    fields: { isPlaceholder: true, source: "hand" },
  };
}
