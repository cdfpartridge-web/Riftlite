"""Two distinct original replay chimes: turn-start and point-scored only."""
from pathlib import Path
import json
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "output" / "replay-audio-masters"
ROOT.mkdir(parents=True, exist_ok=True)
SR = 48000


def resonances(length, modes, attack):
    t = np.arange(round(length * SR)) / SR
    cue = np.zeros(len(t))
    for freq, level, decay in modes:
        env = (1 - np.exp(-t / attack)) ** 2 * np.exp(-t / decay)
        cue += level * env * np.sin(2 * np.pi * freq * t)
    fade = round(.07 * SR)
    cue[-fade:] *= np.linspace(1, 0, fade) ** 2
    return cue


def warm_note(freq, length, decay):
    return resonances(length, [(freq, 1, decay), (freq / 2, .20, decay * .60),
                               (freq * 1.5, .23, decay * .82),
                               (freq * 2.003, .22, decay * .60),
                               (freq * 3.006, .055, decay * .30)], .009)


def lay(mix, cue, start, gain=1):
    offset = round(start * SR)
    length = min(len(cue), len(mix) - offset)
    mix[offset:offset + length] += gain * cue[:length]


def master(mono, peak_db, room=False):
    stereo = np.column_stack([mono, mono])
    if room:
        for channel, seconds in enumerate([.029, .036]):
            delay = round(seconds * SR)
            stereo[delay:, channel] += mono[:-delay] * .04
    edge = round(.008 * SR)
    stereo[:edge] *= np.linspace(0, 1, edge)[:, None]
    stereo[-edge:] *= np.linspace(1, 0, edge)[:, None]
    stereo *= 10 ** (peak_db / 20) / np.max(np.abs(stereo))
    return stereo


def save(name, cue):
    with wave.open(str(ROOT / name), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes(np.rint(cue * 32767).astype("<i2").tobytes())


# Turn: two softer, lower notes with an unmistakable rising rhythm.
turn = np.zeros(round(.88 * SR))
lay(turn, warm_note(329.628, .30, .087), .025, .64)
lay(turn, warm_note(391.995, .61, .175), .205)
turn = master(turn, -13.0, room=True)

# Score: one quick upper-register bell, a different timbre as well as rhythm.
point = np.zeros(round(.51 * SR))
ping = resonances(.455, [(987.767, 1, .082), (493.884, .25, .068),
                       (1978.1, .17, .043), (2839.8, .035, .021)], .0025)
lay(point, ping, .020)
point = master(point, -13.0)

levels = {}
for name, cue in {"turn-start": turn, "point-scored": point}.items():
    save(name + ".wav", cue)
    preview = np.concatenate([np.zeros((round(.2 * SR), 2)), cue,
                              np.zeros((round(1.0 * SR), 2)), cue,
                              np.zeros((round(.45 * SR), 2))])
    save(name + "-preview.wav", preview)
    levels[name] = {"duration_seconds": len(cue) / SR,
                    "peak_dbfs": round(20 * np.log10(np.max(np.abs(cue))), 2),
                    "rms_dbfs": round(20 * np.log10(np.sqrt(np.mean(cue ** 2))), 2)}
(ROOT / "audio-levels.json").write_text(json.dumps(levels, indent=2) + "\n", encoding="utf-8")
print(json.dumps(levels, indent=2))
