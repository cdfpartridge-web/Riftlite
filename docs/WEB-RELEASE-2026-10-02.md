# Recording and sharing refresh — website companion release

Prepared with the user's authorization to publish the finished updates alongside desktop **v0.9.80**. Production promotion and verification are recorded below after completion.

The website branch starts from the September 30 release receipt `db8ab6d`, retaining runtime source `d8082ed` and its Radiance, private Team invitation and explicit Hub-joining changes. The previous live deployment is `dpl_EsWq83gECBfrku7HYSDZRdhq2usV` (`https://riftlite-ktn0p6cbc-cdfpartridge-3985s-projects.vercel.app`).

## Changes

- The desktop can explicitly retry a failed Discord destination after its setup is repaired. Successful deliveries remain deduplicated, including partial deliveries to multiple hubs.
- An owner-reviewed result can release a pending Discord report only when its capture session, canonical player perspective and game numbers match the owner's immutable replay. The report uses the reviewed outcome; the stored replay, board and source identities remain unchanged.
- Cached delivery responses return the replay's current visibility rather than claiming that a subsequently private replay is Unlisted.
- The October 1 card audit adds 22 Radiance prints, bringing the preview catalog to 110 and the compact training registry to 1,299. It includes Mordekaiser, three new battlefields, promotional/signature identifiers and the Lost to the Sands spelling compatibility. See [the card audit](./CARD-SCAN-2026-10-01.md).

## Validation

- Full web suite: **1,406 tests passed in 170 files**; nine existing Firestore emulator tests remain skipped.
- TypeScript passed with incremental output disabled.
- ESLint across `src`, production scripts and tests passed with zero errors and 14 existing warnings. Local preview helpers are excluded.
- Regression coverage includes reviewed-result identity rejection, pending-result recovery, current privacy, explicit retry, partial-delivery deduplication, every audited card fallback and TCGA signature/promotional code handling.
- Local build, staged Vercel build and promotion checks are recorded below as they complete.

No database migration, security-rule update, invitation/member change or Discord message is part of release verification. Local environment captures and output evidence are excluded from deployment. The pre-existing generated `next-env.d.ts` change is preserved and excluded from the source commit.

Evidence: `output/release-0980-web-20261002/` (ignored).
