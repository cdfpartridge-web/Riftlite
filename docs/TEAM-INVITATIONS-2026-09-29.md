# Team invitations — 29 September 2026

Website and both required database indexes were published on 30 September 2026; see the [web release receipt](./WEB-RELEASE-2026-09-30.md). Desktop changes are included in v0.9.79, with installer status recorded in the desktop release receipt. These are Team invitations; they do not add Private Hub membership or Discord permissions. The validation details below retain the original 29 September local checkpoint.

## User flow

In RiftLite Desktop, an owner/admin opens Community → Teams → their team → **Invite member**. The Members panel offers a RiftLite handle with **Send invite**, or **Create invite link** and **Copy link**. Pending invitations can be revoked. Invitations addressed to a handle appear on the recipient's Teams landing page with **Join / Decline**; joining refreshes and opens the team.

Links open `/teams/invite/{inviteId}`. The recipient signs in or creates a profile, sees the selected account, and explicitly chooses **Join team**. Successful acceptance links to **My Teams** at `/account/teams`. That authenticated page lists private/public memberships and addressed invitations, and lets team owners/admins manage invites. The public Teams directory links to My Teams. Private team slugs remain inaccessible to nonmembers; the authenticated page does not reuse an existing team slug.

One link admits one new member, expires after 14 days, and can be revoked by a current owner/admin. Existing members can check open links without consuming them or losing their role. The website and desktop both identify invitation-only teams and suppress ordinary application forms for them.

## Authorization and data

`teamInvites` is server-only under the existing default-deny Firestore rules. Invite IDs contain 24 random bytes. Public bearer-link summaries expose only the team name, inviter display name, target handle, status and expiry; no roster, account UID, email, board or match data.

Creation, revocation and admission validate canonical identities and validated aliases. Acceptance rechecks the current team, invitation, recipient restriction, expiry, current inviter authority and membership inside a transaction. Existing roles and counts are preserved. A used invitation cannot restore removed membership. Concurrent uses of one link, different links for one account and pending application acceptance cannot double-count members or downgrade admins. Application review is also transactional, and private/invite-only teams reject unsolicited applications.

Invitation lists query open, unexpired records before limiting results. Two new composite indexes in `firestore.indexes.json` cover team and targeted-account lists. Deploy those indexes and wait for readiness before releasing the website/desktop feature. Preserve existing indexes; do not authorize deletion of unrelated deployed indexes.

Account/team changes discard stale desktop and web responses. The shared account panel ignores obsolete sign-in/profile/action completions and lets callers choose the success link; Team acceptance now links to My Teams while other flows retain their existing destination.

## Validation

- Desktop: 2,630 tests passed; renderer and Electron TypeScript checks passed; Vite production renderer build passed into a separate ignored output directory.
- Website: 1,381 tests passed, 9 existing skips; TypeScript passed; targeted ESLint passed. The existing public Teams page retains two pre-existing image-element warnings.
- Production website build passed: `next build --webpack` (local dependency link requires Webpack instead of Turbopack).
- Browser checks with synthetic accounts: desktop handle invitation/link display, website link creation, inbox join and refreshed membership, and mobile account-confirmation layout. DOM tests additionally cover copy fallback, revoke/decline, removed membership/demotion refresh and account-switch races.
- No real invitation was sent, accepted or revoked. No production data, Discord messages, installer assets, versions or Git refs changed.

Local evidence: `output/team-invitations-20260929/` in both repositories and website `output/playwright/team-invites/`. Preview fixtures are synthetic and excluded from source control. Earlier Hub/Discord fixes and all pre-existing dirty files are preserved.
