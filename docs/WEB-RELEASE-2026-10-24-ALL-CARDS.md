# Automatic Atlas All cards — website release

The user explicitly authorized deployment on 24 October 2026 so they can test the All cards option with the latest local desktop installer. This publishes the website attachment API and viewer controls, together with the pending targeting-arrow orientation fix in the same viewer. It does not publish or rebuild desktop installers.

Player view remains the default. Full-card attachments start private, require the replay owner's account and exact game/frame matching, preserve the captured opening and canonical timeline, and do not change private notes. Sharing requires the owner's explicit per-game choice. See [All cards implementation](./ATLAS-AUTOMATIC-ALL-CARDS-2026-10-24.md) and [arrow orientation](./REPLAY-ARROW-ORIENTATION-2026-10-23.md).

Deployment uses an immutable committed Git archive, the existing RiftLite Vercel project and production configuration, with domain promotion withheld until candidate checks pass. Local demo scripts, ignored output and the pre-existing next-env.d.ts bytes are preserved and excluded from the change commit. No replay reprocessing, account write, data migration or Discord post is included. The previous production deployment is retained for rollback.

Evidence is recorded in `output/all-cards-deploy-20261024/`. A publication receipt will be appended after candidate and live verification.

## Testing the recent game

Earlier failures against the absent website endpoint may have exhausted the desktop's six-attempt in-memory budget. After deployment, fully quit/reopen the latest local RiftLite build, open Atlas signed in and leave it at its lobby for around a minute. The original replay must be Ready, with automatic Interactive replay upload enabled for the same account. The queue scans up to ten eligible captures from the past six hours. Atlas availability and bounded network retries can take longer.

Reopen the replay while signed into its owning RiftLite account, then choose All cards. The opening retains Player view where Atlas has no corresponding frames. Private card information is not shown to other viewers unless the owner enables sharing. A real installed-game attachment has not yet been demonstrated by the agent; anonymous deployed checks and isolated owner/privacy fixtures do not substitute for that test.

## Published and verified

- Website runtime: `197d0e43dcf5d1e428dbf034a0cf8947cff08c31`, pushed to `codex/opening-turns-lab-20260923`.
- Live deployment: `dpl_5u36hqwVXeNT77d77cspwEXKQ7JB` at https://www.riftlite.com. Previous `dpl_8Qk5bD4m31uZHJXW21gw14e33a3F` is retained.
- Exact archive SHA256: `b7afd306b0ff5dc2482011ea6a7fd8a92e04a680c56042d4b73f5cbeedc33612`.
- Verified test matrix: **1,837 passed, nine skipped**. The initial full run passed 1,833 and found four outdated total-request assertions in two player tests. URL-aware fixtures now separately check the canonical replay and new metadata request; all 82 tests in the four affected/related suites passed. No runtime change was needed for those failures. Scoped lint and TypeScript passed. Four extra final blank lines were removed before committing; remote production build/TypeScript then passed from the exact archive.
- Candidate and live checks each passed **57 read-only GETs** covering pages, playback assets, existing private-review restrictions and the new supplement metadata/full-read route. The endpoint changed from the previous deployment's HTML 404 to the expected JSON response. Anonymous readers receive no private supplements.
- A fresh anonymous browser loaded the public replay, advanced playback, paused and hid the side panel. The canonical replay was fetched once and new metadata returned 200. Opponent hands remained hidden. Only expected anonymous-review 401 and favicon 404 resource errors were observed; no JavaScript exception. The owner-only live import/projection remains for the user's real-game test.
- Original next-env.d.ts SHA256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`, demo scripts and other local files were preserved. No desktop rebuild/release, real-profile launch, account mutation or Discord post.

Evidence: `publication.json`, `local-validation.json`, `runtime-source.json`, `candidate-verification.json`, `live-verification.json`, `live-browser-verification.json` and `production-after.json` under `output/all-cards-deploy-20261024/`. Subsequent documentation commits do not change the deployed runtime.
