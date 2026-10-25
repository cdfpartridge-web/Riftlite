# Shared All cards and opponent opening summaries — 25 October 2026

**Live at 11:39 UK:** runtime `8fa1f985d361c6956b9e704eab2c820269564fb9`, deployment `dpl_6moLoY6bkFyLLc2coEXHF7eyfQgf`, on `https://www.riftlite.com`. The immutable archive SHA256 is `60035fddc2f59bca52272d0c6e9f19535606e55a86ca66d865f610f9cbabca76`. The production build and seven candidate/seven live GET checks passed. On the actual reported Riven–Kai'Sa replay, anonymous metadata and full attachment reads now return one available shared game; anonymous private-review access still returns 401. No production backfill or note write was performed.

## Requested behaviour

The user asked for All cards to be shared by default on all replays while notes remain private, then requested the opponent's opening hand and mulligan choices on the Opening hands screen.

Existing and new Atlas attachments now default to sharing with people who already have access to the original replay. Private replays and restricted Hub access retain their existing access checks. Owners can still turn sharing off for each game. Private review notes, original replay visibility, canonical data and timeline are not changed.

The old stored `shared` boolean did not distinguish the initial private default from a deliberate opt-out. Under the explicit all-replays request, all unversioned attachments now follow the shared default, including historical `false` values. No production backfill is needed. New explicit choices use `sharingPreferenceVersion: 1`; opt-outs survive replacement imports, including a sharing change made while an upload is in progress. The marker is server-only, and the API shape remains unchanged.

When All cards is selected, Opening hands now shows the same verified opponent kept cards, replacement draws and unknown returned-card count as the Mulligan screen. It does not invent the returned identities or include the extra first-turn draw. The original own hand and Player view remain unchanged. Missing metadata falls back to the original captured hand with an explanation. Account, attachment or replay-access loss clears the summary.

## Validation and publication

All 251 relevant tests passed, including server sharing/access, private review access, core Atlas validation, full player presentation, account hooks and controls. Isolated TypeScript, scoped lint and independent privacy review passed. Synthetic Chromium checks at 1540×1000 and 960×700 confirm four loaded summary images, two unknown returns, no extra first-turn draw, unchanged own hand, Player view restoration, the following Mulligan scene and contained layout. These are layout and visibility checks with synthetic fixture identities, not a live game assertion.

The fresh anonymous production browser also passed on the actual Riven–Kai'Sa replay: All cards is enabled, Opening hands shows four verified kept cards with four correctly loaded images, and that game's opponent has zero replacements/returns. Player view restores all four hidden cards and the own hand remains unchanged. Private review access returns 401; no private notes are exposed. The owned browser was closed after the read-only check. Its receipt is `output/atlas-sharing-opening-local-20261025/live-browser-qa-receipt.json`; the live screenshot is `output/playwright/atlas-sharing-opening-20261025/live-opening-all-cards-1540x1000.png`.

Evidence is under `output/shared-allcards-opening-20261025/`; browser evidence is under `output/playwright/atlas-sharing-opening-20261025/`. The isolated preview is `http://127.0.0.1:4253/`; the older 4252 preview is preserved. This is a website change; the existing local Windows installer remains sufficient. No installer rebuild, installation, version bump, real-profile mutation or note-data migration is part of this work.

Previous live runtime: `ae1932ea6543c64f512ba13604a34db13becf8e7`, deployment `dpl_Ba73x37qveZeLBKVTPCJoGPU7Zny`. Preserve it as the rollback deployment. Pre-existing website `next-env.d.ts` bytes, local preview scripts, all desktop dirty work and older installers are preserved.
