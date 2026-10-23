# Official Radiance season — 23 October 2026

The user requested the official Radiance season across app and website filters, as the default, with the same small reminder used for pre-season. They chose **“From now”**. Both repositories use the fixed boundary **23 October 2026 at 13:11:27 Europe/London (BST)**, or **`2026-10-23T12:11:27.000Z`**. Do not move this cutoff to a later build or deployment time.

`radiance` is a distinct season. `radiance-preseason` retains its original start of `2026-10-10T16:35:38.000Z` and ends exclusively at the official season boundary. Official Radiance includes matches at or after that boundary. Vendetta, Vendetta preview, Pre-Vendetta and All seasons remain available. No stored match data is reset or migrated.

Website coverage uses the shared season resolver and defaults: community meta/matrix/matches/decks, legend and player detail, deck detail/comparison, public profiles, team profiles, Meta Studio, replay libraries, and homepage current meta. Homepage lifetime counters remain lifetime counters. Both populated and empty Meta Studio menus now use the shared season list. The amber notice explains the new default, fixed start and preserved pre-season/older history.

Recorded match time takes precedence over upload time. Date-only records retain midnight UTC; a date-only 23 October match is not assumed to have occurred after the midday cutoff. Date and season filters intersect. Explicit `season=` remains All seasons. The legacy desktop community endpoint still returns all history when the season parameter is absent, so older clients retain their available history. Practice training pools and stream/session totals retain their existing scope.

This source change does not alter account permissions, replay visibility or historical retention. `next-env.d.ts` and local demo scripts are excluded from the release and must be preserved. Baseline `next-env.d.ts` SHA256: `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`.

## Source validation

Full website suite: **1,772 passed, nine skipped** (194 passed files, one skipped). Scoped ESLint and `git diff --check` passed. Added regressions cover the exact launch boundary, preserved pre-season start/end, recorded time over upload time, date-only history, homepage current-meta versus lifetime counters, replay switching, default/reset controls, archive-preserving navigation and legacy desktop API omitted/explicit seasons.

TypeScript passed with the ignored `output/radiance-season-20261023/tsconfig.validation.json`, covering source, tracked scripts and current generated routes while excluding archived output and the untracked local demo. The first default wildcard run exhausted Node's 4 GB heap after including 4,825 archived TypeScript files under ignored output. No product config or preserved environment file was changed to run validation.

`next-env.d.ts` remained byte-identical to the baseline hash above. Release build, candidate browser checks, deployment and publication receipts are coordinated separately by the release owner.

## Publication

Published and verified with desktop v0.9.86. Live deployment `dpl_8Qk5bD4m31uZHJXW21gw14e33a3F` uses runtime `520c4c49776bee683380d72698337054c59b9362`. See [release receipt](./WEB-RELEASE-2026-10-23.md) for build, HTTP and live browser results. The fixed cutoff above is unchanged.
