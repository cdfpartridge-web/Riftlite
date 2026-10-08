# Discord account sign-up — local implementation, 7 October 2026

Discord can create a RiftLite account as well as restore an existing account. These are local source changes only. The last verified public website remains the October 5 deployment recorded in WEB-RELEASE-2026-10-05.md. No deployment, production account mutation, bot operation, credential change or desktop release is part of this implementation.

## Account flow

- Continue with Discord is available in the shared website account panel and in desktop linking. Google and email remain available.
- The existing OAuth authorization-code flow proves the Discord user ID using `identify` only. It does not request email, server access, guild membership or bot installation.
- A transaction reads the server-owned `discordAccountIdentities/{discordUserId}` binding and all prior guild verification records. One unambiguous canonical account is reused. An unlinked identity gets a new random RiftLite UID. Concurrent first sign-ins resolve to the same binding.
- Identity alias conflicts, cycles, failed reads, ambiguous historical accounts and pinned desktop reconnect mismatches fail closed. There is no matching or merging by Discord name, RiftLite display name or email. Existing Google/email users should keep their original sign-in method unless Discord was already connected to that account.
- The usual profile flow requires a chosen display name and unique handle. Public website sign-in returns through Account and provides a Continue link to the original same-origin page. Desktop sign-in keeps its existing session/code and profile/link completion flow.
- During the Discord proof exchange, an already signed-in browser account cannot be mistaken for the newly selected Discord identity. The account returned by the custom-token sign-in is authoritative.

## Boundaries and configuration

This adds an authentication binding, not a private hub/team membership or Discord server verification. It does not enable public profiles, discoverability, marketing, replay uploads, automatic Discord posting, microphone recording or cloud backup.

The mapping collection is server-only under the existing Firestore default-deny rules. No rules or indexes are added. The current `DISCORD_CLIENT_ID` / `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, optional `DISCORD_OAUTH_REDIRECT_URI`, and Firebase Admin configuration are reused. The registered callback remains `/api/auth/discord/callback`; no provider scope or callback change is needed. Missing OAuth configuration returns a clear 503 response. Live credentials and interactive provider sign-in were not exercised.

Official implementation references: [Discord authorization-code flow and identify scope](https://docs.discord.com/developers/topics/oauth2), [Firebase custom authentication](https://firebase.google.com/docs/auth/admin/create-custom-tokens).

## Local validation

Focused coverage exercises registration/repeat sign-in, concurrent registration, canonical migration, multiple historical accounts, pinned reconnect rejection, read failures, malformed identity data, OAuth state checks, public and desktop callback routing, profile completion, unchanged profile consent, ambient browser account isolation, existing desktop linking and hub/team invitations.

- Expanded account regression run: 95 tests passed across 10 files.
- Full website suite: 1,507 tests passed across 175 files; nine existing Firestore emulator tests skipped.
- Subsequent security review tightened normalized return-path checks and stale asynchronous UI handling. The final affected-suite rerun passed 61 tests across five files, including the new stale-response regression.
- TypeScript and changed-file ESLint passed. Live provider sign-in and a new production build were not run.

The pre-existing `next-env.d.ts` bytes remain preserved (SHA-256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`). This work is uncommitted and undeployed; a later authorized deployment is required before new Discord accounts work against the public website.
