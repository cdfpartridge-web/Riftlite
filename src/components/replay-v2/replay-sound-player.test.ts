import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReplaySoundPlayer, type ReplaySoundPlayer } from "./replay-sound-player";

class FakeSource {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 0 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "suspended";
  currentTime = 7;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async () => ({ duration: 0.8 }) as AudioBuffer);
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  });

  constructor() { FakeAudioContext.instances.push(this); }
}

function response(bytes = 8, headers: Record<string, string> = {}) {
  return {
    ok: true,
    headers: new Headers(headers),
    body: null,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const players: ReplaySoundPlayer[] = [];
const context = () => FakeAudioContext.instances.at(-1)!;
function player() {
  const result = createReplaySoundPlayer();
  players.push(result);
  return result;
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async () => response()));
});

afterEach(() => {
  for (const item of players.splice(0)) item.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("replay sound playback", () => {
  it("does no browser or network work until a user gesture unlocks it", async () => {
    const sound = player();
    sound.play("turn-start", 0.2);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();

    const unlocked = sound.unlock();
    expect(context().resume).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "/sounds/replay/v1/turn-start.mp3", "/sounds/replay/v1/point-scored.mp3",
    ]);
    expect(fetch).toHaveBeenCalledWith("/sounds/replay/v1/turn-start.mp3", expect.objectContaining({
      credentials: "omit", redirect: "error", signal: expect.any(AbortSignal),
    }));
    await unlocked;
    expect(context().sources).toHaveLength(0);
  });

  it("drops cues before decode rather than playing them late", async () => {
    const asset = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(asset.promise);
    const sound = player();
    const unlock = sound.unlock();
    sound.play("point-scored", 0.2);
    asset.resolve(response());
    await unlock;
    expect(context().sources).toHaveLength(0);
    sound.play("point-scored", 0.2);
    expect(context().sources[0].start).toHaveBeenCalledOnce();
  });

  it("uses a fixed pitch, clamps volume and ignores muted or invalid levels", async () => {
    const sound = player();
    await sound.unlock();
    for (const volume of [0, -1, NaN, Infinity]) sound.play("turn-start", volume);
    expect(context().sources).toHaveLength(0);
    sound.play("turn-start", 2);
    expect(context().sources[0].playbackRate.value).toBe(1);
    expect(context().gains[0].gain.value).toBe(1);
    context().sources[0].onended?.();
    sound.play("point-scored", 0.15);
    expect(context().gains[1].gain.value).toBe(0.15);
  });

  it("lets a point replace a turn with a short fade and suppresses bursts", async () => {
    const sound = player();
    await sound.unlock();
    sound.play("turn-start", 0.2);
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(1);
    sound.play("point-scored", 0.2);
    expect(context().sources[0].stop).toHaveBeenCalledWith(7.012);
    expect(context().gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 7.012);
    sound.play("turn-start", 0.2);
    sound.play("point-scored", 0.2);
    expect(context().sources).toHaveLength(2);
    context().sources[0].onended?.();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(2);
    context().sources[1].onended?.();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(3);
  });

  it("stops and disconnects both current and fading cues immediately", async () => {
    const sound = player();
    await sound.unlock();
    sound.play("turn-start", 0.2);
    sound.play("point-scored", 0.2);
    sound.stop();
    for (const source of context().sources) {
      expect(source.stop).toHaveBeenLastCalledWith();
      expect(source.disconnect).toHaveBeenCalledOnce();
      expect(source.onended).toBeNull();
    }
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(3);
    await sound.unlock();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not play while the browser has suspended audio", async () => {
    const sound = player();
    await sound.unlock();
    context().state = "suspended";
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(0);
    await sound.unlock();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(1);
  });

  it("retains a working cue when the other asset fails, and retries only the missing cue", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (url === "/sounds/replay/v1/point-scored.mp3") throw new Error("offline");
      return response();
    });
    const sound = player();
    await sound.unlock();
    sound.play("point-scored", 0.2);
    expect(context().sources).toHaveLength(0);
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(1);
    sound.stop();
    vi.mocked(fetch).mockResolvedValue(response());
    await sound.unlock();
    expect(fetch).toHaveBeenCalledTimes(3);
    sound.play("point-scored", 0.2);
    expect(context().sources).toHaveLength(2);
  });

  it("retries after the browser rejects the initial resume gesture", async () => {
    vi.stubGlobal("AudioContext", class extends FakeAudioContext {
      constructor() {
        super();
        this.resume.mockRejectedValueOnce(new Error("gesture required"));
      }
    });
    const sound = player();
    await expect(sound.unlock()).resolves.toBeUndefined();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(0);
    await sound.unlock();
    sound.play("turn-start", 0.2);
    expect(context().resume).toHaveBeenCalledTimes(2);
    expect(context().sources).toHaveLength(1);
  });

  it("invalidates a late decode after stop, allowing a fresh unlock to recover", async () => {
    const asset = deferred<Response>();
    const decoded = deferred<AudioBuffer>();
    vi.mocked(fetch).mockReturnValue(asset.promise);
    const sound = player();
    const loading = sound.unlock();
    context().decodeAudioData.mockReturnValue(decoded.promise);
    asset.resolve(response());
    await vi.waitFor(() => expect(context().decodeAudioData).toHaveBeenCalledTimes(2));
    sound.stop();
    await loading;
    decoded.resolve({ duration: 0.5 } as AudioBuffer);
    await Promise.resolve();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(0);
    context().decodeAudioData.mockResolvedValue({ duration: 0.5 } as AudioBuffer);
    await sound.unlock();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(1);
  });

  it("disposes pending work without starting late audio or fetching again", async () => {
    const asset = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(asset.promise);
    const sound = player();
    const loading = sound.unlock();
    sound.dispose();
    asset.resolve(response());
    await loading;
    await sound.unlock();
    sound.play("point-scored", 0.2);
    expect(context().close).toHaveBeenCalledOnce();
    expect(context().sources).toHaveLength(0);
    expect(context().decodeAudioData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled loads and shares one load between repeated gestures", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const sound = player();
    const first = sound.unlock();
    expect(sound.unlock()).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8_000);
    await first;
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
    vi.mocked(fetch).mockResolvedValue(response());
    await sound.unlock();
    sound.play("point-scored", 0.2);
    expect(context().sources).toHaveLength(1);
  });

  it("rejects excessive advertised, streamed and decoded asset sizes", async () => {
    const sound = player();
    vi.mocked(fetch).mockResolvedValue(response(1, { "content-length": "600000" }));
    await sound.unlock();
    expect(context().decodeAudioData).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(response(600_000));
    await sound.unlock();
    expect(context().decodeAudioData).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(600_000)));
    await sound.unlock();
    expect(context().decodeAudioData).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(response());
    context().decodeAudioData.mockResolvedValue({ duration: 60 } as AudioBuffer);
    await sound.unlock();
    sound.play("turn-start", 0.2);
    expect(context().sources).toHaveLength(0);
  });

  it("handles missing browser APIs and constructor failures without throwing", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const sound = player();
    await expect(sound.unlock()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("unavailable"); } });
    await expect(sound.unlock()).resolves.toBeUndefined();
    vi.stubGlobal("window", undefined);
    await expect(sound.unlock()).resolves.toBeUndefined();
    expect(() => sound.play("turn-start", 0.2)).not.toThrow();
  });

  it("isolates audio device failures from the replay controls", async () => {
    const sound = player();
    await sound.unlock();
    context().createBufferSource.mockImplementationOnce(() => { throw new Error("device lost"); });
    expect(() => sound.play("turn-start", 0.2)).not.toThrow();
    sound.play("point-scored", 0.2);
    context().sources[0].stop.mockImplementation(() => { throw new Error("device lost"); });
    expect(() => sound.stop()).not.toThrow();
    expect(context().sources[0].disconnect).toHaveBeenCalledOnce();
  });
});
