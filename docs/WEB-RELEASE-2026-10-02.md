# Recording and sharing refresh — website companion release

Published to https://www.riftlite.com at approximately **21:40 BST on 2 October 2026**, with the user's authorization to publish the finished updates alongside desktop **v0.9.80**.

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
- Local Webpack build and Vercel's staged Turbopack production build both passed on Next.js 16.2.11.

No database migration, security-rule update, invitation/member change or Discord message is part of release verification. Local environment captures and output evidence are excluded from deployment. The pre-existing generated `next-env.d.ts` change is preserved and excluded from the source commit.

Evidence: `output/release-0980-web-20261002/` (ignored).

## Publication receipt

- Immutable runtime source: `23ab3cf0e92859d872201925fd1b0a2240b46789`, pushed to `codex/opening-turns-lab-20260923`.
- Deployment: `dpl_GLPVDqpFc1vKCnRugLKt195t3ngo`, https://riftlite-27t2gbtk7-cdfpartridge-3985s-projects.vercel.app.
- Built using `--prod --skip-domain`; the live custom domain was verified to remain on the previous deployment during candidate checks. Promoted only after the candidate passed.
- `vercel inspect www.riftlite.com` confirms the new deployment is READY. The previous deployment above is retained for rollback.
- Candidate and live checks passed for My Teams, explicit invitation confirmation, the existing public replay, Download, signed-out invitation API rejection (401), and signed-out Discord sharing rejection (401). The latter never reached delivery or a user-data write.
- All 27 referenced public JavaScript bundles loaded successfully and included the new legend/card/battlefield markers, signature/promotional support, spelling compatibility, existing battlefield orientation and Team invitation support.
- `/download` revalidates every 600 seconds, but its rendered Windows and both Mac links use GitHub's `/releases/latest/download/` URLs. No page regeneration, CMS mutation or new website deployment is needed when the matching desktop releases become Latest.
- The ignored temporary environment file was deleted after local build; the original `next-env.d.ts` bytes were restored and its existing dirty state was preserved.

The desktop repositories record Windows and Mac installer publication separately; this receipt verifies the supporting website deployment.
