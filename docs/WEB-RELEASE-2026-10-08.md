# Atlas status indicators, card prints and Discord sign-up

The user authorized a local desktop rebuild and publication of the website updates on 8 October 2026. This website release includes the completed local Atlas statuses/cards work and Discord account sign-up. Desktop publication and installation are not part of this request.

## Included changes

- Web replay cards and enlarged previews display all 11 Atlas status presets, including numeric buffs and counted labels, while preserving custom labels/counters and hiding opponent-private fields.
- Added 61 verified prints across desktop/web catalogs (50 Radiance); 1,426 total prints and 200 Radiance. Riven legend support and exact alternate artwork are included. All previous card records are preserved.
- Continue with Discord supports creating an account or returning to a previously connected account. Existing Google/email accounts retain their original sign-in flow. Identity conflicts fail closed; names and emails are never used to guess or merge identities. Profile completion still requires a chosen display name and unique handle.

Implementation details: [Atlas statuses and cards](./ATLAS-STATUS-CARDS-2026-10-08.md), [Discord sign-up](./DISCORD-SIGNUP-2026-10-07.md).

## Validation and scope

The full website suite passed 1,527 tests in 176 files; the nine existing Firestore emulator tests remain skipped. TypeScript and ESLint passed (zero errors, 14 existing warnings). The synthetic browser fixture checks all status presets, custom labels, counters, hidden-card protection and enlarged previews at 1920×1080 and 1280×720. Desktop rebuild validation passed 2,773 tests, 82 account checks, TypeScript, production compilation, Windows artifact verification and isolated packaged startup/first-install setup.

Deployment uses a Git archive of the exact website runtime commit. Ignored output, local environment files and the pre-existing generated `next-env.d.ts` edit are excluded. That file's original bytes remain in the active checkout. No new provider scopes, OAuth callback registration, Firestore rules or indexes are required. No support repair, replay reprocessing, production account creation, real-profile operation or Discord message is part of verification.

The candidate is built with production configuration but without moving the live domain, then verified and promoted. The publication receipt below is filled only after these steps succeed. Interactive Discord account creation is covered by mocked tests, not a production account write.

Evidence directory: `output/release-atlas-status-cards-20261008/`.
