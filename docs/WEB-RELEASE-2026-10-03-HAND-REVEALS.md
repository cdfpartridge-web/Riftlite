# Opponent hand reveals

Atlas sends individual hand cards with `revealedToOpponent: true` when a game effect reveals them. The web normalizer previously replaced those opponent cards with anonymous placeholders, and the player only showed hand identities inferred by Cards up. This change preserves authoritative explicit hand reveals and displays them during ordinary playback.

Only incoming authoritative data with a known capture perspective can reveal an opponent hand card. Other hidden zones, ordinary hand cards and later unknown draws remain concealed. Conceal patches clear previously visible identity fields; moves into hidden zones cannot carry stale reveal flags. Seeking uses visibility at the selected time. Cards up can use an explicit in-hand reveal as evidence under its existing private-zone and game reset rules.

## Validation

- Full suite: 1,432 tests passed in 171 files; nine existing Firestore emulator tests skipped.
- TypeScript and targeted ESLint passed. New coverage includes snapshots, inserts, moves, reveal/conceal patches, non-authoritative records, unknown perspectives, later draws and backward seeking.
- Reprocessed only `rl2_f4d30b5583c0e14e36429470c3c58689` in a read-only dry-run. The comparison permits only the seven confirmed revealed identities and their derived checkpoint changes. Listing metadata and all unrelated canonical data are unchanged.
- Verified the repaired replay locally in Chromium with Cards up off: seven hidden cards before 12:48.839; seven named cards at the reveal; seven named cards plus one hidden draw at 12:49.944. Backward seeking hides the identities again.

Ignored evidence and the scoped repair utility are in `output/reveal-hand-20261003/`; browser evidence is in `output/playwright/hand-reveal-local-after.png`. Temporary production credentials are removed after each scoped operation. The repair preserves the original raw and canonical artifacts for rollback, and updates only this replay's canonical artifact pointer after a full-record compare-and-swap check. No other replay, delivery, membership or visibility change is included.

## Publication

Publication receipt will be added after candidate verification, promotion and the scoped repair. The previous live deployment is `dpl_GLPVDqpFc1vKCnRugLKt195t3ngo` (runtime source `23ab3cf0e92859d872201925fd1b0a2240b46789`). This is a website-only correction; no desktop installer update is required.
