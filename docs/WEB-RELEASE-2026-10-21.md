# Replay visual clarity — 21 October 2026

The user approved the local demo and requested publication. This website release adds recorded Atlas targeting arrows, brief trash/rune recycling movements, and active rune counts above both players' rune areas. It also reaches the existing shared desktop replay viewer; no installer or desktop version change is needed.

Behavior, compatibility and completed tests are recorded in [the implementation receipt](./REPLAY-TARGETS-MOTION-2026-10-20.md). Recorded arrows require targeting data in the original capture. Hidden cards stay hidden during movements. Active runes means ready runes out of the total in play, excluding the rune deck.

## Release process

Deploy an exact Git archive to the existing RiftLite Vercel project with production configuration and `--skip-domain`. Verify the candidate before promotion, then verify the live domain. Local demo scripts, ignored output and the pre-existing `next-env.d.ts` edit are excluded. Existing files and generated build metadata are preserved in the active worktree.

The completed implementation passed 1,763 tests (nine skipped), followed by 73 focused player/projection tests for the active-rune addition. TypeScript, scoped lint and actual-player browser fixtures passed at 1920×1080 and 1280×800 with both perspectives. Publication adds a fresh production build and deployed route/bundle checks.

No database migration, account mutation, replay reprocessing or Discord post is included. The previous production deployment is retained for rollback. Release evidence: `output/release-replay-clarity-20261021/`. The publication receipt is appended after successful promotion and verification.

## Publication receipt

Published to https://www.riftlite.com on **21 October 2026 at 09:13 UK time**.

- Immutable runtime source: `c910a13b6f5e68d5ba8f84eb34bd08669e7108be`, pushed to `codex/opening-turns-lab-20260923`.
- Production deployment: `dpl_6PQbwc9WzjZFDVGCPurEg1bnc4F1`, https://riftlite-3fwspv84p-cdfpartridge-3985s-projects.vercel.app.
- Source archive SHA256: `5771c52eac41fbb838ee80f71d5126f4b5a2fec6ef4b5b65035c2259731eb98e`.
- Fresh Vercel production build and TypeScript passed. Prior source validation passed 1,763 tests (nine skipped), followed by 73 focused checks for active rune counts.
- Candidate and live verification passed seven page URLs, 34 JavaScript bundles and 6 stylesheets. New target, movement and active-rune markers were present; existing reviews, might labels, panel control and Radiance markers remained present. Anonymous/invalid-token review reads remained private/no-store 401 responses, and public replay data loaded.
- Isolated browser verification passed on the public replay viewer; detailed acceptance is in `output/release-replay-clarity-20261021/live-browser-verification.json`. Local fixtures cover both players' arrows, movement privacy, recycling, playback controls and exhausted rune counts. No real account writes were performed.
- Previous deployment `dpl_jGHmmRLHsMvfxyZcrAfeUmRuvJim` remains available for rollback. Pre-existing `next-env.d.ts`, build metadata and local demo scripts were preserved. No desktop build, installer, version bump or replay reprocessing was needed.
