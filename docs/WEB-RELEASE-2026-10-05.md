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

Ignored evidence: `output/release-0981-web-20261005/`.

No database migration, replay reprocessing, membership/account mutation or Discord posting is part of this release. Download links already use GitHub's `/releases/latest/download/` URLs; desktop installers are recorded separately.

## Publication receipt

Published to https://www.riftlite.com on **5 October 2026 at approximately 14:09 BST**, before the matching desktop v0.9.81 publication.

- Immutable runtime source: `06e73d7d278728b5fd46e76b95c3501300e6090a`, pushed to `codex/opening-turns-lab-20260923`.
- Deployment: `dpl_EriWYN9FBWEoBRXhaeRoW8mCPXm1`, https://riftlite-fs4ysslb3-cdfpartridge-3985s-projects.vercel.app.
- Source archive SHA-256: `9ace3d2f65538128b43f78a494457de79f17fb86123918c23c8623aa49f1567e`. The deployed source came from this Git archive, with only the existing Vercel project link added outside source control.
- Vercel's production build and TypeScript checks passed on Next.js 16.2.11. The candidate was created using `--prod --skip-domain`; the live domain was verified to remain on the preceding deployment before promotion.
- Candidate and live checks passed for My replays, a public replay, the embedded visibility editor, Download and My Teams. Every HTML response identified this exact deployment. All **28** referenced JavaScript bundles loaded successfully and included the visibility actions, new Radiance prints, signed Mordekaiser identity and new battlefield names.
- Unauthenticated owner metadata access returned 401; cookie-based PATCH without an Origin returned 403; a same-origin unauthenticated PATCH returned 401; unauthenticated Discord sharing returned 401. These requests never changed a replay or posted a Discord message. Successful owner flows and non-owner rejection were covered by mocked tests, not production account writes.
- `vercel inspect www.riftlite.com` confirmed the new deployment is READY after promotion. The generated `next-env.d.ts` retained its original bytes and remains the only pre-existing worktree modification.
- Previous live deployment retained for rollback: `dpl_HfrE4qsvuzX83etiqS12mcUsrnGu`, https://riftlite-ohlfv49l5-cdfpartridge-3985s-projects.vercel.app, runtime source `4dbc946186abb89be6e47aaf9400672a39cac482`.

The first candidate verification expected the printed signed code `RAD-170*` in compiled bundles. It correctly appears as normalized replay code `RAD-170S`; the verification-only marker was corrected and the complete candidate check passed. No source or deployed runtime change was required.
