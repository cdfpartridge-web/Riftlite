import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalReplayV2, ReplayEvent, ReplayPatchOperation } from "@/lib/replay-v2";

const audio = vi.hoisted(() => ({
  unlock: vi.fn(async () => undefined), play: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
}));
const createPlayer = vi.hoisted(() => vi.fn(() => audio));
vi.mock("./replay-sound-player", () => ({ createReplaySoundPlayer: createPlayer }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }) }));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { ReplayV2Player } from "./ReplayV2Player";
import { REPLAY_SOUND_PREFERENCE_KEY } from "./use-replay-sounds";

let replay: CanonicalReplayV2;
let now = 0;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/sound-test");
  replay = soundFixture();
  now = 0;
  frameId = 0;
  frames.clear();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
    headers: { "content-type": "application/json" },
  })));
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  if (!HTMLElement.prototype.animate) HTMLElement.prototype.animate = () => ({ pause() {}, play() {} }) as Animation;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function advance(milliseconds: number) {
  for (let remaining = milliseconds; remaining > 0; remaining -= 100) {
    now += Math.min(100, remaining);
    act(() => {
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback(now);
      }
    });
  }
}

async function open(search = "?t=0.001") {
  window.history.replaceState({}, "", `/sound-test${search}`);
  const view = render(createElement(ReplayV2Player, {
    replayId: "sound-test",
  }));
  await waitFor(() => expect(view.getByRole("slider", { name: "Replay progress" })).toBeInTheDocument());
  return view;
}

describe("replay sound integration", () => {
  it("starts muted and never creates the audio engine during silent playback", async () => {
    const view = await open();
    expect(view.getByRole("button", { name: "Enable replay sounds" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    advance(3_500);
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("3501");
    expect(createPlayer).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("unlocks from enable/play gestures and emits the distinct natural turn and score cues", async () => {
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    expect(createPlayer).toHaveBeenCalledOnce();
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    expect(audio.unlock).toHaveBeenCalledTimes(2);
    advance(1_000);
    expect(audio.play.mock.calls).toEqual([["turn-start", 0.5]]);
    advance(2_000);
    expect(audio.play.mock.calls).toEqual([["turn-start", 0.5], ["point-scored", 0.5]]);
    advance(5_000);
    expect(audio.play.mock.calls).toEqual([
      ["turn-start", 0.5], ["point-scored", 0.5], ["turn-start", 0.5], ["point-scored", 0.5],
    ]);
    advance(3_000);
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(audio.play).toHaveBeenCalledTimes(4); // There is no game-end cue.
  });

  it("keeps seeks and event stepping silent, including seeks while playback continues", async () => {
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    advance(3_500);
    audio.play.mockClear();
    audio.stop.mockClear();
    fireEvent.change(view.getByRole("slider", { name: "Replay progress" }), { target: { value: "7000" } });
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("7000");
    expect(view.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
    expect(audio.stop).toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    advance(1_000);
    expect(audio.play.mock.calls).toEqual([["point-scored", 0.5]]);
    audio.play.mockClear();
    fireEvent.change(view.getByRole("slider", { name: "Replay progress" }), { target: { value: "0" } });
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    expect(audio.play).not.toHaveBeenCalled();
  });

  it("keeps exact frame navigation silent and resumes from the selected event", async () => {
    const view = await open("?t=8");
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    fireEvent.click(view.getByRole("button", { name: "More" }));
    fireEvent.change(view.getByRole("slider", { name: "Replay frame" }), { target: { value: "4" } });
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("3000");
    expect(audio.play).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    advance(3_000);
    expect(audio.play.mock.calls).toEqual([["turn-start", 0.5]]);
  });

  it("plays the final clip score without truncating its tail and restarts from the clip beginning", async () => {
    // A turn after the shared clip end must not sound.
    const end = replay.events.pop()!;
    replay.events.push(action(7, 9_000, [{ id: "outside-turn", op: "set_room_fields", fields: { turnNumber: 4 } }]));
    replay.events.push({ ...end, index: 8, id: "sound-event-8" });
    replay.series.games[0].eventEndIndex = 8;
    const view = await open("?start=0&end=8");
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    advance(7_900);
    audio.stop.mockClear();
    audio.play.mockClear();
    advance(100);
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("8000");
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(audio.play.mock.calls).toEqual([["point-scored", 0.5]]);
    expect(audio.stop).not.toHaveBeenCalled();
    advance(1_000);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();
    audio.stop.mockClear();
    audio.unlock.mockClear();
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    expect(view.getByRole("slider", { name: "Replay progress" })).toHaveValue("0");
    expect(audio.stop.mock.invocationCallOrder.at(-1)).toBeLessThan(audio.unlock.mock.invocationCallOrder.at(-1)!);
    advance(1_000);
    expect(audio.play).toHaveBeenLastCalledWith("turn-start", 0.5);
  });

  it.each([false, true])("sounds the first turn only when the prelude completes automatically: %s", async (automatic) => {
    replay.events[1] = { ...base(1, 0), kind: "phase", phase: "mulligan", rawPhase: "mulligan", gameNumber: 1 };
    const snapshot = replay.events[2];
    if (snapshot.kind === "snapshot") {
      snapshot.snapshot.room.phase = "mulligan";
      snapshot.snapshot.room.rawPhase = "mulligan";
    }
    replay.events[3] = { ...base(3, 1_000), kind: "phase", phase: "in_game", rawPhase: "in_game", gameNumber: 1 };
    replay.series.games[0].phases = [
      { phase: "mulligan", rawPhase: "mulligan", startEventIndex: 1, endEventIndex: 2, startedAtMs: 0, endedAtMs: 1_000 },
      { phase: "in_game", rawPhase: "in_game", startEventIndex: 3, endEventIndex: 7, startedAtMs: 1_000, endedAtMs: 10_000 },
    ];
    const view = await open("");
    expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    for (let step = 0; step < 5; step += 1) fireEvent.click(view.getByRole("button", { name: "Next action" }));
    expect(view.container.querySelector('[data-scene="game_start"]')).toBeInTheDocument();
    expect(audio.play).not.toHaveBeenCalled();
    if (automatic) {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click(view.getByRole("button", { name: "Play replay" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1_800); });
      expect(audio.play.mock.calls).toEqual([["turn-start", 0.5]]);
    } else {
      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      expect(audio.play).not.toHaveBeenCalled();
    }
    expect(view.container.querySelector('[data-scene="game_start"]')).not.toBeInTheDocument();
  });

  it("stops on pause and mute, remembers volume, and suppresses zero-volume cues", async () => {
    const view = await open();
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    fireEvent.click(view.getByRole("button", { name: "Replay sound settings" }));
    fireEvent.change(view.getByRole("slider", { name: "Replay sound volume" }), { target: { value: "35" } });
    expect(JSON.parse(window.localStorage.getItem(REPLAY_SOUND_PREFERENCE_KEY)!)).toEqual({ enabled: true, volume: 0.35 });
    fireEvent.click(view.getByRole("button", { name: "Play replay" }));
    advance(1_000);
    expect(audio.play).toHaveBeenLastCalledWith("turn-start", 0.35);
    audio.stop.mockClear();
    fireEvent.click(view.getByRole("button", { name: "Pause replay" }));
    expect(audio.stop).toHaveBeenCalled();
    audio.stop.mockClear();
    fireEvent.click(view.getByRole("button", { name: "Mute replay sounds" }));
    expect(audio.stop).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(REPLAY_SOUND_PREFERENCE_KEY)!)).toEqual({ enabled: false, volume: 0.35 });
    fireEvent.click(view.getByRole("button", { name: "Enable replay sounds" }));
    view.unmount();
    expect(audio.dispose).toHaveBeenCalledOnce();

    const restored = await open();
    expect(restored.getByRole("button", { name: "Mute replay sounds" })).toHaveAttribute("aria-pressed", "true");
    expect(createPlayer).toHaveBeenCalledOnce(); // Restoring preferences never unlocks audio.
    fireEvent.click(restored.getByRole("button", { name: "Replay sound settings" }));
    expect(restored.getByRole("slider", { name: "Replay sound volume" })).toHaveValue("35");
    fireEvent.change(restored.getByRole("slider", { name: "Replay sound volume" }), { target: { value: "0" } });
    audio.play.mockClear();
    fireEvent.click(restored.getByRole("button", { name: "Play replay" }));
    advance(3_000);
    expect(audio.play).not.toHaveBeenCalled();
    expect(createPlayer).toHaveBeenCalledOnce();
  });
});

function base(index: number, atMs: number) {
  return { id: `sound-event-${index}`, index, at: 1_000 + atMs, atMs, sourceMessageId: `sound-message-${index}`, gameId: "sound-game" };
}

function action(index: number, atMs: number, operations: ReplayPatchOperation[]): ReplayEvent {
  return {
    ...base(index, atMs), kind: "action", actionType: "local_sound_demo", actorPlayerId: "self",
    action: { type: "local_sound_demo" },
    confirmation: { status: "confirmed", authority: "authoritative_patch_commit", correlation: "intent_not_observed", commitMessageId: `sound-message-${index}` },
    patch: { operations },
  };
}

function soundFixture(): CanonicalReplayV2 {
  const events: ReplayEvent[] = [
    { ...base(0, 0), kind: "game_boundary", boundary: "start", gameOrdinal: 1, gameNumber: 1, reason: "series_start" },
    { ...base(1, 0), kind: "phase", phase: "in_game", rawPhase: "in_game", gameNumber: 1 },
    { ...base(2, 0), kind: "snapshot", snapshot: {
      room: { phase: "in_game", rawPhase: "in_game", gameNumber: 1, activeTurnPlayerId: "self", firstPlayerId: "self", turnNumber: 1, fields: {} },
      players: Object.fromEntries(["self", "opponent"].map((id, seat) => [id, {
        id, name: seat ? "Opponent" : "You", seat, score: 0, fields: {}, boardFields: { score: 0 }, zones: {},
      }])), chain: [], log: [],
    } },
    action(3, 1_000, [{ id: "turn-2", op: "set_room_fields", fields: { turnNumber: 2, activeTurnPlayerId: "opponent" } }]),
    action(4, 3_000, [{ id: "point-1", op: "set_board_fields", playerId: "self", fields: { score: 1 } }]),
    action(5, 6_000, [{ id: "turn-3", op: "set_room_fields", fields: { turnNumber: 3, activeTurnPlayerId: "self" } }]),
    action(6, 8_000, [{ id: "point-2", op: "set_board_fields", playerId: "opponent", fields: { score: 1 } }]),
    { ...base(7, 10_000), kind: "game_boundary", boundary: "end", gameOrdinal: 1, gameNumber: 1, reason: "capture_end" },
  ];
  return {
    schema: "riftlite-canonical-replay", version: 2, id: "sound-test",
    source: { schema: "riftreplay-raw-capture", version: 1, captureSessionId: "sound-test", roomCode: "TEST", startedAt: 1_000, endedAt: 11_000, messageCount: events.length },
    series: {
      id: "sound-series", perspectivePlayerId: "self", format: "bo1", bestOf: 1, roomCode: "TEST", startedAt: 1_000, endedAt: 11_000,
      participants: [
        { id: "self", name: "You", isPerspective: true, fields: {} },
        { id: "opponent", name: "Opponent", isPerspective: false, fields: {} },
      ],
      games: [{
        id: "sound-game", ordinal: 1, gameNumber: 1, sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["sound-test"] },
        startedAt: 1_000, endedAt: 11_000, startedAtMs: 0, endedAtMs: 10_000, eventStartIndex: 0, eventEndIndex: events.length - 1,
        phases: [{ phase: "in_game", rawPhase: "in_game", startEventIndex: 1, endEventIndex: events.length - 1, startedAtMs: 0, endedAtMs: 10_000 }],
      }],
    }, events, unknownEvents: [], diagnostics: [], checkpoints: [],
  };
}
