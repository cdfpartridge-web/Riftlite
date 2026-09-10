# RiftLite Results Bot — public installation release

Completed 10 September 2026, approximately 09:53 BST. The user explicitly left the second-server live installation/isolation check pending.

## Live release

- Application and bot username: **RiftLite Results Bot**, previously RB Uk Testing.
- Application ID: `1524708623790510241`; separate from RiftLite's LFG applications.
- Install: https://discord.com/oauth2/authorize?client_id=1524708623790510241
- Interaction endpoint: https://www.riftlite.com/api/discord/bot/interactions
- Privacy policy: https://www.riftlite.com/privacy — bot-specific explanation deployed and linked in the Developer Portal.
- Source commit: `a32ffa745c8ab0dd51592f899f06c299940b860e` on local branch `codex/results-bot-public-20260910`.
- Vercel deployment: `dpl_2WNRMFFsUQU3XGHZLqB1VFn48jtV`.
- Immutable deployment URL: https://riftlite-1yca1lgs3-cdfpartridge-3985s-projects.vercel.app
- `www.riftlite.com` was confirmed to resolve to this READY production deployment after promotion.
- Prior production deployment: `dpl_9eNwYuMFd4j56VhDLrzWXDbv2Sih`, source baseline `135d2398f33f77888adb3716b87ba81d16966b8d`.

This was built and deployed from the isolated `results-bot-release-20260910` worktree. The release includes 19 bot/guide/privacy files and four minimal baseline test-fixture typing corrections. Local Your Move, website artwork/release-label, desktop and Android changes were excluded. No desktop installer or APK was built or published. No GitHub push was performed.

## Public installation settings

Public Bot is enabled. Installation and commands are restricted to Discord servers, with User Install disabled. Defaults are `bot` and `applications.commands`, permissions `3072` (View Channels and Send Messages). No Administrator permission or privileged gateway intents are required. Optional verified roles require a separate Manage Roles grant and a basic member role below the bot.

All ten commands were registered globally, then the existing Team UK test-server override was updated to the same definitions:

`help`, `status`, `disconnect`, `verify`, `verified`, `setup`, `recent`, `leaderboard`, `weekly-report`, `testing-goals`.

The live Discord API confirmed command names/options, server-only contexts/install types, admin defaults, application identity, bot username, installation permissions and privacy URL. The public invitation was also inspected in the signed-in browser up to the server-selection form. It was not used to install into another server.

The copyable guide is [riftlite-results-bot-user-guide.txt](./riftlite-results-bot-user-guide.txt): two plain-text Discord messages, 1,672 and 1,702 characters. It was written for the user to post; no guide or test report was posted to Discord.

## Changes and boundaries

- Signed interactions supply the server identity. Invalid/expired signatures, foreign application IDs, direct messages and user-only installations are rejected.
- Private acknowledgements are sent before database work. Deferred webhook edits preserve the private response and suppress mentions.
- One account-managed private hub connects to one server. Setup uses a transaction; duplicate, missing, deleting, legacy-only or stale-admin configurations fail closed.
- Results require a server-specific verified account link and current membership of that server's connected hub. Recent match queries accept both supported timestamp fields.
- Report/replay delivery validates the current connection, configuring administrator, channel's actual server and bot permissions. Replay sharing remains an explicit opt-in; no eligible destination leaves replay visibility unchanged.
- Testing goals remain pinned to their original hub across reconnections, including concurrent list/rebind handling. Unknown goal IDs do not create records.
- `/help`, `/status` and `/disconnect` add setup guidance, private administrative inspection and a way to stop future access/delivery.
- Command registration requires an explicit scope and `--apply`; the Results token must match the Results application before any write. There is no fallback to the separate LFG bot token.

Server administrators control who can read the reports channel. Explicitly posted reports are visible to those channel readers. Unlisted replay URLs can be forwarded outside the server; disconnecting does not revoke an existing URL or delete existing posts. Existing Discord roles are not automatically removed when a person leaves a hub. Administrators should remove roles/channel access during offboarding.

Discord posts and Firestore receipts are not one atomic transaction. Claims and deterministic nonces reduce duplicate delivery, but exactly-once delivery after an uncertain external network failure is not guaranteed. A network failure after visibility preparation may leave a replay Unlisted. There is no automatic weekly report scheduler, general match-feed scheduler or historical replay backfill.

## Verification

- Full isolated regression suite: **142 test files passed, 1 skipped; 1,104 tests passed, 9 skipped** (`npx vitest run --maxWorkers=4`, 77.58 seconds).
- Bot isolation, delivery and registration regression cases passed, including independent-server data, stale/rebound configurations, role/channel checks and deferred private responses.
- Focused ESLint and Git diff checks passed.
- Local optimized production build passed, including TypeScript and prerendering. The separate Vercel Linux/Turbopack production build also passed.
- Ten built-HTTP checks passed with temporary signing keys and synthetic private responses. The real Next `after()` lifecycle acknowledged commands in milliseconds and performed the expected private webhook edit. This test made **zero live Discord or database calls**.
- Protected candidate checked through Vercel's authenticated CLI: updated privacy content, unsigned interaction rejection (401), and operator API rejection without its credential (401).
- After promotion, the same checks passed directly through the public website.
- Read-only live configuration audit found one installed server, an existing account-managed hub, no duplicate binding, a currently authorised configuring owner, correct-server accessible channels and an existing optional verification role. No match, replay or message bodies were read.

The first unrestricted-concurrency full-suite run had one five-second timeout in an unchanged replay presentation test while the production build was also running. The complete suite passed after the build with four workers; no timeout increase or production-code workaround was introduced.

## Remaining acceptance

**Pending at the user's request:** install into a second independent server and exercise real signed-in `/verify`, `/setup`, results commands and an opted-in replay post against two separate hubs. Automated isolation tests and metadata checks do not replace this full live acceptance sequence. No live user slash-command interaction or channel post was triggered during this release.

Direct public invitation is configured. App Directory listing, monetization and new Terms of Service are separate work and were not created here.

## Operator handover

The implementation remains in the original `zelonius-web-20260826` worktree alongside its pre-existing local changes, and the reviewed deployment is preserved separately in `results-bot-release-20260910`. Continue local Your Move work in its original worktree; do not deploy that entire dirty tree as a bot hotfix. Reconcile the isolated release commit deliberately when preparing the next broader website release.

Ignored evidence is in `output/results-bot-release-20260910/` in the release worktree (`checks.json`, HTTP smoke report, registration audit, source manifests and deployment snapshots) and `output/discord-results-readiness-20260910/` in the original worktree (`live-readiness-after.json`). These folders also contain local credential captures. Never commit or upload them.

See [discord-bot.md](./discord-bot.md) for operator settings, command registration, privacy details and official Discord references.
