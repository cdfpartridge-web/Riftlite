# Radiance, Team invitations and Hub confirmation — live web release

Published to https://www.riftlite.com on 30 September 2026 with the user's authorization to include all finished updates.

- Runtime source: `d8082ed422a3ebb481fad0c9fcbb1641d1582c31` (includes the main release commit `ba5267d`).
- Deployment: `dpl_EsWq83gECBfrku7HYSDZRdhq2usV`, promoted after both invitation indexes were ready and their production query shapes passed.
- Deployment URL: https://riftlite-ktn0p6cbc-cdfpartridge-3985s-projects.vercel.app.
- Previous deployment: `dpl_CvXPn527JpCurxZ3wvvocWaP1fL3`, retained for rollback. Earlier candidates were not promoted to the custom domains.

## Changes

- All 88 revealed Radiance collector identities from the audited Piltover Archive / Riot union are supported, including six new legends, five battlefields, Bomb and signed/alternate prints. The catalog retains the 1,189 previous normalized desktop records. See [the source audit](./RADIANCE-PREVIEW-2026-09-30.md).
- Battlefield artwork now uses loaded image dimensions: native landscape scans remain upright while portrait scans retain the existing rotation. Verified on the board, hover preview and inspector with a clearly labeled synthetic Radiance fixture; it was never uploaded as a real game.
- Private Team invitation links, addressed invitations, My Teams and owner/admin invite management are live. Admission is explicit and transactional. Team membership does not grant private Hub membership.
- Hub links require explicit account confirmation; existing admins retain their roles, and previewing a link cannot consume it. Discord verification explains the separate Hub membership requirement.

## Database and verification

Created only these two composite indexes in `teamInvites`, with collection scope:

1. `teamId ASC, status ASC, expiresAt DESC` — `CICAgJj7z4EK`.
2. `targetUid ASC, status ASC, expiresAt DESC` — `CICAgNi47oMK`.

Both reached READY. Read-only production queries using nonexistent release-verification identities passed for the exact equality and `in` filters used by the application. No invitation, membership, user role, security rule or Discord message was modified during publication.

- Full web suite: 1,384 passed, 9 existing skips. Follow-up replay/orientation checks: 68 passed, including two new orientation regressions. TypeScript and targeted ESLint passed; two existing image-element warnings remain in the Teams directory.
- Local Webpack build and final Vercel Turbopack production build passed.
- Candidate routes, explicit-join UI bundles, all Radiance markers and orientation support passed. Signed-out invitation API requests return 401.
- Five live route checks passed: My Teams, missing invitation, signed-out invitation API, an existing public replay and Download. Production replay bundles contain the new catalog and orientation support.
- All 90 audited card image URLs returned HTTP 200 with image content types. New cards are current to 30 September; no unrevealed rules or cards were invented.

Evidence: `output/radiance-release-20260930/` (ignored), including build logs, index readiness, query checks, candidate/live checks and screenshots. The temporary production environment file was deleted after verification. Existing `next-env.d.ts` local changes are preserved.

Desktop capture/catalog and Team UI changes are part of desktop v0.9.79. Its installer publication is recorded in the desktop repository's `docs/RELEASE-2026-09-30.md`.
