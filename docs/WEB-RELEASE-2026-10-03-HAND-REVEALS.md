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

Published on **3 October 2026 at approximately 17:29 BST**.

- Runtime source: `4dbc946186abb89be6e47aaf9400672a39cac482`, pushed to `codex/opening-turns-lab-20260923`.
- Deployment: `dpl_HfrE4qsvuzX83etiqS12mcUsrnGu`, https://riftlite-ohlfv49l5-cdfpartridge-3985s-projects.vercel.app.
- Vercel's production build and TypeScript checks passed. Built with `--prod --skip-domain`, verified the candidate while the live domain remained on the previous deployment, then promoted.
- Live checks passed for the replay page, all 13 referenced JavaScript bundles, the repaired public replay API and the Download page.
- The scoped repair restored seven identities across 58 event/checkpoint card occurrences. Its transaction changed only `canonicalArtifact`; the raw capture, original canonical artifact and every other record field were preserved.
- Live canonical SHA-256 matches the dry-run candidate exactly: `5ef27c7eec99825355dc18817caeb724e5473a2a962aed74c1588f2faf65ad65`.
- Live Chromium verification with local interception removed shows all seven named cards and the hidden eighth draw at https://www.riftlite.com/replays/rl2_f4d30b5583c0e14e36429470c3c58689?t=770. Screenshot: `output/playwright/hand-reveal-live-after.png`. The browser reported only the unrelated `/favicon.ico` 404.

The previous live deployment is `dpl_GLPVDqpFc1vKCnRugLKt195t3ngo` (runtime source `23ab3cf0e92859d872201925fd1b0a2240b46789`). Old canonical pointer and complete repair receipts are retained in ignored evidence for rollback. Other historical replays were not reprocessed. This is a website-only correction; no desktop installer update is required.
