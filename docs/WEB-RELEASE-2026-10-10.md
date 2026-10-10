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

## Publication receipt

Published to https://www.riftlite.com on **10 October 2026 at 18:21 BST**. This supersedes the source-only / pending-deployment status in the earlier dated implementation notes.

- Immutable runtime source: `8f335a67f27f4e0c87ab3acf9c0b5030c694b6e7`, pushed to `codex/opening-turns-lab-20260923`.
- Deployment: `dpl_FMWAigBbZDynDBXciKebWTADkZsV`, https://riftlite-opby7djv2-cdfpartridge-3985s-projects.vercel.app.
- Source archive SHA256: `eae42a188c526d639b7ed449d05ce1cc94ac8860351354c814aa8200e778666c`. Only the existing Vercel project link was added to the extracted archive.
- Vercel's fresh Next.js 16.2.11 production compilation and TypeScript checks passed. The candidate used `--prod --skip-domain`; the live domain was confirmed to remain on the previous deployment until candidate checks passed, then promotion completed.
- Candidate and live checks passed on 12 page URLs covering replay library, public replay, embedded visibility controls, account, download, teams, community meta/matches, archived/All views, Riven detail and deck comparison. Every HTML response identified the exact deployment.
- All **36** referenced JavaScript bundles returned successfully and contained the new season/cutoff, announcement, October card additions, Atlas status presets and Discord sign-up UI.
- Both candidate and live default / explicit Radiance matches APIs returned the same ten current-period matches. All ten were at or after the fixed cutoff. The Vendetta request returned 100 inspected matches, all before the cutoff and at or after 31 July, out of 6,990 available rows. All seasons returned a total of 7,000 in the existing backend history window. These are verification-time counts, not a promise of complete historical retention.
- Discord authorization started with a 307 redirect, scope `identify`, and the production callback `https://www.riftlite.com/api/auth/discord/callback`. Missing state and incomplete link requests returned 400. Redirects were not followed and no account was created or linked during verification.
- `vercel inspect www.riftlite.com` confirmed the new deployment is READY after promotion. Active worktree `next-env.d.ts` remains unchanged at SHA256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`; `tsconfig.tsbuildinfo` remains `fbadf3d251f4755bdb3a58040443f2c22c248fe2c09f75be11104bba1171a211`.

Previous live deployment is retained for rollback: `dpl_EriWYN9FBWEoBRXhaeRoW8mCPXm1`, https://riftlite-fs4ysslb3-cdfpartridge-3985s-projects.vercel.app, runtime `06e73d7d278728b5fd46e76b95c3501300e6090a`. No old deployment or release asset was removed.
