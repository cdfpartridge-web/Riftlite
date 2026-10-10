# Radiance pre-season — website release, 10 October 2026

The user explicitly authorized a rebuild, version bump and deployment after the Radiance filters and announcement were completed. Desktop versioning and publication are recorded separately; the website keeps its internal package version and is identified by immutable source and deployment IDs.

## Included changes

- Radiance pre-season is the default across community reports, personal/public profiles, team profiles, detail and comparison pages, Meta Studio and replay libraries. Older seasons and explicit All seasons remain available.
- The fixed cutoff is **10 October 2026 at 17:35:38 UK time**, `2026-10-10T16:35:38.000Z`. Recorded match time takes precedence over upload time. No history is reset or migrated.
- A compact highlight box explains the new period and how to access older results; controls remain available for an empty period.
- The October 10 card sweep adds 19 verified prints and refreshed names/art, bringing the registry to 1,445 prints and Radiance to 218.
- This publication also includes the previously pushed October 8 Atlas status indicators, card additions and Discord account sign-up, which had not reached the live website.

Details: [Radiance scope and validation](./RADIANCE-PRESEASON-2026-10-10.md), [October 10 catalog audit](./CARD-SCAN-2026-10-10.md), [October 8 changes](./WEB-RELEASE-2026-10-08.md).

## Validation and release scope

The completed source passed 1,552 website tests (nine existing emulator tests skipped), then 63 focused checks including final navigation/empty-state regressions. TypeScript and scoped ESLint passed. Actual browser fixtures covered season navigation, exact boundaries, All seasons and narrow layouts. The deployment performs a fresh production build and TypeScript check.

The candidate uses an exact Git archive, excluding local environment captures, output artifacts and the pre-existing generated `next-env.d.ts` edit. Its original bytes and `tsconfig.tsbuildinfo` are preserved in the active worktree.

Deployment is to the existing RiftLite Vercel project, first with production configuration and `--skip-domain`, then promoted after candidate verification. Live verification uses unauthenticated GET requests only. No database migration, profile/account mutation, provider configuration, replay reprocessing, Discord message or parked-feature activation is part of this release. Opening Turns Lab and Replay Coach remain Coming soon. Training practice pools retain all available historical evidence and their explicitly dated legacy comparisons.

Evidence: `output/release-radiance-20261010/`. The publication receipt is added after successful promotion and live verification.
