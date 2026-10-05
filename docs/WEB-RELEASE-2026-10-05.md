# Replay visibility and card catalog — website companion release

The user authorized rebuilding, bumping and releasing the finished changes on 5 October 2026, alongside desktop v0.9.81. The website must be promoted before desktop publication because it supplies the owner visibility editor and automatic Discord privacy guard.

## Changes

- Existing uploaded replays have a highlighted Change visibility action with explicit Public, Unlisted and Private choices. The same editor works from desktop's authenticated embedded library and its saved-game shortcuts. Future upload defaults remain separate.
- Owner-only metadata reads and same-origin session mutations support the desktop's HttpOnly session; bearer clients remain compatible. Cross-origin cookie mutations and non-owner access remain rejected. The management query grants no access by itself.
- Automatic Discord delivery preserves current visibility and stops when the owner has made a replay Private. Explicit manual sharing retains its existing consent flow. No Discord post is used for deployment verification.
- The card audit adds 66 verified prints: 40 Radiance and 26 older alternates, promos and tokens. The replay catalog has 150 Radiance prints and the training registry has 1,365 total prints. Alternate and signed legend artwork, image aliases, Evelynn and new battlefields are supported. Placeholder artwork is excluded.

Details: [visibility fix](./REPLAY-VISIBILITY-2026-10-05.md) and [card audit](./CARD-SCAN-2026-10-05.md).

## Release validation

- Final full website suite: **1,479 tests passed in 173 files**; nine existing Firestore emulator tests remain skipped.
- TypeScript passed with incremental output disabled.
- ESLint across application source, release configuration and production scripts passed with zero errors and 14 existing warnings. Ignored local preview helpers are excluded.
- Existing browser QA uses actual library/editor components with synthetic data and mocked authentication/API; it covers Public/Unlisted saves and a short mobile viewport. No real replay visibility was changed.
- The existing generated `next-env.d.ts` change is preserved and excluded. Deployment uses a Git archive of the immutable release source, so ignored local output, environment captures and generated changes cannot enter it.

Ignored evidence: `output/release-0981-web-20261005/`. Publication details will be appended after the staged build, candidate checks and promotion succeed.

No database migration, replay reprocessing, membership/account mutation or Discord posting is part of this release. Download links already use GitHub's `/releases/latest/download/` URLs; desktop installers are recorded separately.
