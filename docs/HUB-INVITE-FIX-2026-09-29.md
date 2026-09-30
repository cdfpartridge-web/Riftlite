# Private hub invitation confirmation

Status: implemented and validated locally; not deployed. No desktop version change is required.

## Problem

Opening a generic hub invitation while already signed in automatically invoked acceptance through the shared account panel. An administrator previewing their own single-use link could consume it and have their membership document overwritten with the member role. A later visitor saw “already accepted” even though that visitor had never joined. Discord verification without an optional role did not explain the missing hub membership.

Bounded read-only production metadata confirmed this sequence for the reported incident. Customer account identifiers and invitation tokens are excluded from this document. No production membership, invite, role or Discord message was changed.

## Changes

- Hub invitations require an explicit Join confirmation showing the selected account, including after sign-in or profile creation. Other account flows retain their existing completion behavior.
- Acceptance checks validated account identities, current memberships and owner metadata inside its transaction. Existing members retain the strongest current role and do not consume an open invite.
- An accepted link is an idempotent receipt only for its original accepting identity while that identity is still a member or owner. It cannot restore removed membership. Invite targets, expiry, hub lifecycle and changed hub bindings are rechecked transactionally.
- Used-link copy explains that the link status does not prove the viewer has joined. It links to My Hubs and recommends a fresh personal invitation.
- Discord verification reports missing hub membership whether or not an automatic role is configured. Command authorization and role-assignment restrictions remain intact.

## Immediate recovery

The administrator creates a fresh invite addressed to the player's RiftLite handle. The player accepts using the same RiftLite account used for Discord verification, refreshes My Hubs and retries the command. If the server uses an automatic role, run `/verify` again after joining. No automatic role is needed for hub command access.

## Validation

- Full Vitest suite: 1,309 passed, 9 skipped across 163 files.
- TypeScript `--noEmit`, targeted ESLint and `git diff --check`: passed.
- Regression coverage includes signed-in preview, fresh sign-in/profile confirmation, existing owner/admin roles, validated aliases, target restrictions, removed membership, concurrent acceptance, membership promotion/revocation and ownership transfer.
- Production build with `next build --webpack`: passed. Default Turbopack could not resolve this worktree's external `node_modules` link; no build configuration was changed. Logs are recorded in the local diagnosis output directory. No authenticated live acceptance flow was exercised.

The local evidence directory is ignored by Git. Preserve the pre-existing generated `next-env.d.ts` change when preparing a release.
