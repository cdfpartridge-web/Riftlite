# Selected battlefields overlay — local fix, 27 October 2026

**Website published at 15:09 UK:** [release receipt](./WEB-RELEASE-2026-10-27-BO3-OVERLAY.md). The local-only status below records the pre-publication investigation. Existing canonical data has not been rewritten.

Reported replay: https://www.riftlite.com/replays/rl2_70ade85aa0a70680bb74af4f86a7f378

The live player was reproduced at 1:56, showing Turn 2 while the Selected battlefields overlay covered the board. Its public canonical has 2,409 events, 109 checkpoints and seven inferred games. Three gameplay continuations were split into new segments only 190–261 ms after entering gameplay; those segments retained a battlefield-pick phase for approximately 13–19 minutes. The overlay follows the canonical phase and is not a stuck CSS animation.

## Corrections

`src/lib/replay-v2/derive-replay.ts` previously inferred a new game from an unnumbered setup observation before applying its stale same-game setup guard. Starting the inferred game reset the gameplay history that guard needed. It now rejects that rollover only when the known room still matches the last authoritative in-game snapshot/commit and no postgame signal occurred. The anchor resets on a real game start. Explicit next-game numbers, changed rooms, unknown-identity fallback and ended/inactive transitions remain supported. Early next-room transport messages cannot change the authoritative room anchor.

`src/components/replay-v2/model.ts` supplies a conservative display compatibility guard for already-stored canonical artifacts. An inferred phase-rollover segment must continue the prior authoritative sequence in confirmed gameplay, with the same game-history timestamp and authoritative in-game phase. Carried scores, turn counters or room fields alone are insufficient. Proof is cached as an event range; seeking before that evidence preserves setup. A genuine reset, changed history or phase invalidates it, while a healthy continuing snapshot retains it. No arbitrary timeout or canonical rewrite is used.

## Verification

- Equivalent normalizer regression failed before and passes after; eight new boundary cases preserve real room/number changes, postgame transitions and early next-room transport traffic.
- 59 focused normalization/BO3 tests and 191 focused viewer/player/review tests passed. Independent review found no blockers.
- All 2,409 actual canonical events were sought forward and backward through the stored checkpoints with identical results. Across the three false segments, 2,184 gameplay positions show the board after continuity is established; eight earlier pre-proof positions retain setup. Genuine setup positions remain visible.
- The normal full player was rendered in an isolated browser using the same public canonical and local source. The old model reproduces the overlay at 116.65 seconds; the corrected model renders the board. Browser assertions cover affected positions at 116.65, 1,000 and 2,300 seconds and genuine battlefield selection at 50, 885 and 2,098 seconds. No training-mode overlay suppression was used.
- **1,994 full-suite tests passed**, with nine existing Firestore emulator-only tests skipped. Current-source TypeScript, zero-warning scoped lint, diff checks and the local Next production build passed. One test-only type annotation was repaired after the initial TypeScript check; final TypeScript and the build passed.
- The previous Riven three-game canonical remains byte-identical (3 games / 2,271 events; SHA256 `4bba294050b93c6d639cc260cc9b1068137af0ccfab3d9bee540099d2ab045ad`). All three native attachment saves still pass offline. The pending All cards raw/canonical equality check remains strict.
- Existing `next-env.d.ts` and `tsconfig.json` bytes were restored exactly after the build. Temporary browser and read-only fixture server were closed; existing preview servers were not restarted.

Evidence: `output/battlefield-overlay-20261027/` and `output/playwright/battlefield-overlay-20261027/`. Browser files include the public replay supplied by the user and are ignored local test artifacts, not repository fixtures.

## State and limits

**Local only; nothing deployed or pushed.** The pending October 26 All cards website corrections remain local alongside this fix. Desktop runtime, installer and public releases were not changed by this work. The previous no-publication instruction remains in force.

The original reported replay's private raw capture was unavailable in this public investigation. The synthetic packet regression demonstrates the normalization defect; exact original private room IDs were not verified. The compatibility fix removes the blocking overlay but does not repair the stored seven-game list, review grouping, or battlefield metadata already cleared at false boundaries. Rebuilding that artifact would require separately authorized reprocessing of its original capture. No production replay data, visibility, private notes, unknown cards, or account state was modified.
