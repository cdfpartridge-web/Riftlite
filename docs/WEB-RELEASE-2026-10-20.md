# Replay review tools and private account reviews — 20 October 2026

The user approved the local preview, then explicitly requested “ok push live”.
This release updates the existing RiftLite website and shared desktop replay viewer.
The desktop installer and version remain unchanged.

## Included behavior

- Review game provides a simple walkthrough, captured combat breakdown and action search, keeping BO3 games and hidden-card information separate.
- Save to my reviews creates a personal library for accessible replays, including public replays. Anchored notes save privately to the signed-in RiftLite account.
- Saving never publishes a note or changes the original replay. Notes Share is separate and explicitly explains that anyone with that link can read its included notes. Ordinary replay sharing includes no private notes.
- Concurrent edits require explicit conflict recovery. Account changes hide and clear the previous account's private state. Expired sessions hide private content but retain unfinished changes in the current tab until the same account reconnects; the UI warns users to keep that tab open.
- Saved notes remain readable by their owner if the original replay becomes unavailable, without granting access to the original.
- Guest browser notes remain separate and are not automatically imported. Opening Turns Lab and Replay Coach remain Coming soon.

## Deployment and verification

The candidate is an exact Git archive, excluding local demo accounts, local output, environment files and the pre-existing generated `next-env.d.ts` edit. Only the existing Vercel project link is added to the archive. Production configuration is used with `--skip-domain`; the live domain is promoted only after candidate checks pass.

The account review API uses the existing canonical account authentication, Firebase Admin configuration and replay access policy. Private records use the separate server-only `replayPrivateReviews` collection, covered by the existing deny-all client rule. No database migration, rules change or new environment variable is required.

October 19 validation passed 1,705 website tests (nine skipped), 28 final focused tests, TypeScript, the Webpack production build and browser save/sync/privacy/sharing checks using local demo accounts. The final release gates and publication receipt are recorded below after completion.

Live acceptance uses public pages and unauthenticated API GET requests. Real-account saving and synchronization are not exercised against production by the agent; the authenticated paths are covered by local tests. No user profile mutation, replay reprocessing, Discord message, desktop installation or new desktop release is included.

The published desktop's existing replay cookie lasts ten minutes and is renewed when the app opens its replay viewer. This website release does not add a desktop renewal mechanism. After expiry, saved account notes remain durable, while unfinished changes stay hidden in the current tab and require the same account to reconnect. Reopening the desktop viewer may navigate that tab; closing/reloading it still loses unsaved in-memory work and now triggers a warning. Website Firebase sign-in refreshes automatically and is the practical option for extended review sessions.

Evidence: `output/release-account-reviews-20261020/`.
