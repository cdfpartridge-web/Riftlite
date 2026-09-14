# Web replay sounds — local implementation, 14 September 2026

User approved the latest distinct turn-start and point-scored chimes. No game-end sound. This change is local only; no website deployment, desktop installer rebuild, version bump or Git push was performed.

## Behaviour

- Compact speaker toggle beside playback speed; adjacent chevron opens the volume slider.
- Muted by default. Sound enabled/disabled and volume are stored locally under `riftlite.replay-sounds.v1`; initial volume 50% of already quiet masters.
- Natural playback emits confirmed score increases and recorded gameplay turn changes. Initial partial snapshots, score corrections, duplicate updates and game boundaries do not invent cues.
- Scrubbing, frame/action/turn/game jumps and manual opening-sequence stepping are silent. Automatic opening completion can emit the first turn. Restarting a clip re-unlocks audio after its seek.
- At high speed cues retain their pitch and duration; each clock frame selects at most one cue, with no queue of skipped sounds. Points can replace turn tails; active points suppress other cues.
- Pausing, muting, changing replay, hiding the page or unmounting stops sound. A final scoring cue may finish its short tail when natural playback reaches its end.
- AudioContext creation, same-origin downloads and decoding wait for an enable/play gesture. Stored preferences never autoplay audio. Missing/blocked audio does not stop the replay; another play/enable gesture retries it.

## Files

The player integration is in `src/components/replay-v2/ReplayV2Player.tsx`. Separate modules own cue detection (`replay-sound-cues.ts`), WebAudio lifecycle (`replay-sound-player.ts`), preferences/playback gating (`use-replay-sounds.ts`) and controls (`ReplaySoundControls.tsx` plus CSS). Regression tests accompany detection/engine and actual player integration.

Approved single-cue assets: `public/sounds/replay/v1/turn-start.mp3` and `point-scored.mp3`. Original synthesis is preserved in `scripts/replay-audio/generate-masters.py`; generated masters stay under ignored `output/`.

## Local review in the development worktree

Run from this website worktree: `npx tsx scripts/replay-audio-local/preview.ts` (loopback port 4199). Rebuild its bundle while serving with `npx tsx scripts/replay-audio-local/preview.ts --build-only`.

- `http://127.0.0.1:4199/`: deterministic 10-second sample, turns at 1s/6s, points at 3s/8s.
- `http://127.0.0.1:4199/replay`: existing local Irelia capture, starting just before its first score. Requires the existing ignored `output/atlas-history-local/canonical.json`; no recorded player data is added to source control.

The preview uses the real player with local account-service stubs and read-only fixture endpoints. It does not upload captures or alter live accounts.

Browser verification covers muted/no-media initial load, exact four-cue playback, fixed pitch, live Irelia score playback, silent seeks/steps, zero volume, preference restoration without autoplay, keyboard volume and Escape focus. Screenshots and browser scripts are under ignored `output/playwright/`.

Final validation: 113 tests passed across the player, sound integration, cue detection, audio engine and score markers. Full TypeScript check and targeted ESLint passed. Regenerated WAV master hashes match the approved audition masters exactly. Existing Git line endings and unrelated edits were preserved.

The development worktree has substantial existing unrelated changes. Preserve those and isolate this feature against the latest production source before any later release; do not deploy the whole worktree.

## Release preparation

The user subsequently authorized website deployment. The release worktree `replay-sounds-release-20260914` starts from verified live source `bcad0d3a552648b3328f6877579529e42c04d3cf` (deployment `dpl_Ds17GKnMU3N7o8c7ohABE3pYS6vx`). Only the sound modules/assets and player integration are included. The unpublished Your Move embedded-position controls are excluded; integration tests use existing public playback and clip URLs. Results Bot, owner-only Atlas match decks and BMUCasts feed remain part of this baseline.

The deployment receipt and final production checks will be appended after successful promotion. No desktop installer is being rebuilt or published for this website update.
