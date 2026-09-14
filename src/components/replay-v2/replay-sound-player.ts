export type ReplaySoundKind = "turn-start" | "point-scored";

export type ReplaySoundPlayer = {
  unlock(): Promise<void>;
  play(kind: ReplaySoundKind, volume: number): void;
  stop(): void;
  dispose(): void;
};

const SOUND_PATHS: Record<ReplaySoundKind, string> = {
  "turn-start": "/sounds/replay/v1/turn-start.mp3",
  "point-scored": "/sounds/replay/v1/point-scored.mp3",
};
const LOAD_TIMEOUT_MS = 8_000;
const MAX_ASSET_BYTES = 512 * 1024;
const MAX_CUE_SECONDS = 5;
const INTERRUPT_FADE_SECONDS = 0.012;

type Voice = {
  kind: ReplaySoundKind;
  source: AudioBufferSourceNode;
  gain: GainNode;
};

type LoadJob = {
  controller: AbortController;
  promise: Promise<void>;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/** Sound is optional: media failures must never affect replay playback. */
export function createReplaySoundPlayer(): ReplaySoundPlayer {
  let context: AudioContext | undefined;
  let disposed = false;
  let unlocked = false;
  let generation = 0;
  let pending: LoadJob | undefined;
  let active: Voice | undefined;
  const voices = new Set<Voice>();
  const buffers: Partial<Record<ReplaySoundKind, AudioBuffer>> = {};

  function disconnect(voice: Voice) {
    if (active === voice) active = undefined;
    voices.delete(voice);
    voice.source.onended = null;
    try { voice.source.disconnect(); } catch { /* Already released. */ }
    try { voice.gain.disconnect(); } catch { /* Already released. */ }
  }

  function stopVoice(voice: Voice, fade = false) {
    if (fade && context?.state === "running") {
      try {
        const now = context.currentTime;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0, now + INTERRUPT_FADE_SECONDS);
        voice.source.stop(now + INTERRUPT_FADE_SECONDS);
        if (active === voice) active = undefined;
        return;
      } catch { /* Fall back to an immediate stop. */ }
    }
    try { voice.source.stop(); } catch { /* Already stopped. */ }
    disconnect(voice);
  }

  function stop() {
    generation += 1;
    if (pending) {
      pending.controller.abort();
      clearTimeout(pending.timer);
      pending = undefined;
      unlocked = false;
    }
    for (const voice of voices) stopVoice(voice);
  }

  function unlock(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending.promise;
    if (typeof window === "undefined" || typeof fetch !== "function" || typeof AbortController !== "function") {
      return Promise.resolve();
    }

    if (!context || context.state === "closed") {
      const AudioContextClass = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return Promise.resolve();
      try { context = new AudioContextClass(); } catch { return Promise.resolve(); }
    }

    const audioContext = context;
    const token = ++generation;
    const controller = new AbortController();
    const job: LoadJob = { controller, promise: Promise.resolve(), timer: undefined };
    pending = job;
    const isCurrent = () => !disposed && generation === token && !controller.signal.aborted;

    // Resume synchronously within the caller's user gesture, before fetching assets.
    let resume: Promise<void>;
    try {
      resume = audioContext.state === "running" ? Promise.resolve() : audioContext.resume();
    } catch {
      pending = undefined;
      return Promise.resolve();
    }

    const load = Promise.all([
      resume,
      ...Object.entries(SOUND_PATHS).map(async ([key, path]) => {
        const kind = key as ReplaySoundKind;
        if (buffers[kind]) return;
        try {
          const response = await fetch(path, { signal: controller.signal, credentials: "omit", redirect: "error" });
          if (!response.ok || !isCurrent()) return;
          const encoded = await readBoundedAsset(response);
          if (!isCurrent()) return;
          const buffer = await audioContext.decodeAudioData(encoded);
          if (isCurrent() && Number.isFinite(buffer.duration) && buffer.duration > 0 && buffer.duration <= MAX_CUE_SECONDS) {
            buffers[kind] = buffer;
          }
        } catch { /* Retry a missing or failed cue on the next user gesture. */ }
      }),
    ]).then(() => {
      if (isCurrent()) unlocked = audioContext.state === "running";
    }).catch(() => {
      // Autoplay restrictions can be retried from a later play/enable gesture.
    });

    const timeout = new Promise<void>((resolve) => {
      job.timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, LOAD_TIMEOUT_MS);
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    job.promise = Promise.race([load, timeout]).finally(() => {
      clearTimeout(job.timer);
      controller.abort();
      if (pending === job) pending = undefined;
    });
    return job.promise;
  }

  function play(kind: ReplaySoundKind, volume: number) {
    const buffer = buffers[kind];
    if (disposed || !unlocked || context?.state !== "running" || !buffer || !Number.isFinite(volume) || volume <= 0) return;
    // Rapid playback collapses cues instead of building a queue. A point may
    // replace a turn cue, but nothing interrupts a point already being heard.
    if (active) {
      if (active.kind === "point-scored" || kind === "turn-start") return;
      stopVoice(active, true);
    }

    let source: AudioBufferSourceNode | undefined;
    let gain: GainNode | undefined;
    let voice: Voice | undefined;
    try {
      source = context.createBufferSource();
      gain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = 1;
      gain.gain.value = Math.min(1, volume);
      source.connect(gain);
      gain.connect(context.destination);
      voice = { kind, source, gain };
      voices.add(voice);
      active = voice;
      const startedVoice = voice;
      source.onended = () => disconnect(startedVoice);
      source.start();
    } catch {
      if (voice) stopVoice(voice);
      else {
        try { source?.disconnect(); } catch { /* Nothing to release. */ }
        try { gain?.disconnect(); } catch { /* Nothing to release. */ }
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    unlocked = false;
    delete buffers["turn-start"];
    delete buffers["point-scored"];
    try { void context?.close().catch(() => {}); } catch { /* Unsupported or already closed. */ }
    context = undefined;
  }

  return { unlock, play, stop, dispose };
}

async function readBoundedAsset(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get("content-length")) > MAX_ASSET_BYTES) throw new Error("Replay sound is too large");
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Replay sound is too large");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ASSET_BYTES) throw new Error("Replay sound is too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
