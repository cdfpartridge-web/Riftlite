# Automatic Atlas All cards — website release

The user explicitly authorized deployment on 24 October 2026 so they can test the All cards option with the latest local desktop installer. This publishes the website attachment API and viewer controls, together with the pending targeting-arrow orientation fix in the same viewer. It does not publish or rebuild desktop installers.

Player view remains the default. Full-card attachments start private, require the replay owner's account and exact game/frame matching, preserve the captured opening and canonical timeline, and do not change private notes. Sharing requires the owner's explicit per-game choice. See [All cards implementation](./ATLAS-AUTOMATIC-ALL-CARDS-2026-10-24.md) and [arrow orientation](./REPLAY-ARROW-ORIENTATION-2026-10-23.md).

Deployment uses an immutable committed Git archive, the existing RiftLite Vercel project and production configuration, with domain promotion withheld until candidate checks pass. Local demo scripts, ignored output and the pre-existing next-env.d.ts bytes are preserved and excluded from the change commit. No replay reprocessing, account write, data migration or Discord post is included. The previous production deployment is retained for rollback.

Evidence is recorded in `output/all-cards-deploy-20261024/`. A publication receipt will be appended after candidate and live verification.

## Testing the recent game

Earlier failures against the absent website endpoint may have exhausted the desktop's six-attempt in-memory budget. After deployment, fully quit/reopen the latest local RiftLite build, open Atlas signed in and leave it at its lobby for around a minute. The original replay must be Ready, with automatic Interactive replay upload enabled for the same account. The queue scans up to ten eligible captures from the past six hours. Atlas availability and bounded network retries can take longer.

Reopen the replay while signed into its owning RiftLite account, then choose All cards. The opening retains Player view where Atlas has no corresponding frames. Private card information is not shown to other viewers unless the owner enables sharing. A real installed-game attachment has not yet been demonstrated by the agent; anonymous deployed checks and isolated owner/privacy fixtures do not substitute for that test.
