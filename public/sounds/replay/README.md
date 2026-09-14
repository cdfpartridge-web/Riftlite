# RiftLite replay cues, v1

Original procedural chimes approved on 14 September 2026. No third-party samples.

- `v1/turn-start.mp3`: two warm lower notes, 0.88-second master.
- `v1/point-scored.mp3`: one short higher chime, 0.51-second master.

Both masters peak at -13 dBFS. The player defaults to muted and remembers a 50% volume setting. Files are stereo 48 kHz MP3 at 160 kb/s; together about 30 KB. These contain one cue each, not the repeated audition previews. There is no game-end cue.

Reproduce WAV masters with `python scripts/replay-audio/generate-masters.py` (NumPy required). Output stays in ignored `output/replay-audio-masters/`. Encode each single master with FFmpeg using `-codec:a libmp3lame -b:a 160k`.

Keep the versioned asset paths immutable when changing an approved sound.
