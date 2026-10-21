# Replay visual clarity — 21 October 2026

The user approved the local demo and requested publication. This website release adds recorded Atlas targeting arrows, brief trash/rune recycling movements, and active rune counts above both players' rune areas. It also reaches the existing shared desktop replay viewer; no installer or desktop version change is needed.

Behavior, compatibility and completed tests are recorded in [the implementation receipt](./REPLAY-TARGETS-MOTION-2026-10-20.md). Recorded arrows require targeting data in the original capture. Hidden cards stay hidden during movements. Active runes means ready runes out of the total in play, excluding the rune deck.

## Release process

Deploy an exact Git archive to the existing RiftLite Vercel project with production configuration and `--skip-domain`. Verify the candidate before promotion, then verify the live domain. Local demo scripts, ignored output and the pre-existing `next-env.d.ts` edit are excluded. Existing files and generated build metadata are preserved in the active worktree.

The completed implementation passed 1,763 tests (nine skipped), followed by 73 focused player/projection tests for the active-rune addition. TypeScript, scoped lint and actual-player browser fixtures passed at 1920×1080 and 1280×800 with both perspectives. Publication adds a fresh production build and deployed route/bundle checks.

No database migration, account mutation, replay reprocessing or Discord post is included. The previous production deployment is retained for rollback. Release evidence: `output/release-replay-clarity-20261021/`. The publication receipt is appended after successful promotion and verification.
