# Radiance pre-season stats — 10 October 2026

## Status and cutoff

Local source implementation only. No installer rebuild, installation, version change, push, deployment, tag movement or production data mutation was performed for this request. Existing local changes and older candidates remain intact.

The user chose **“From now”**. The fixed start is **10 October 2026 at 17:35:38 Europe/London (BST)**, or **`2026-10-10T16:35:38.000Z`**. Radiance includes matches at or after that instant. Vendetta ends immediately before it. Do not recalculate the cutoff at build or deployment time.

## Behaviour

- Radiance pre-season is the default stats period on desktop and website. Older Vendetta, Vendetta Preview, Pre-Vendetta and all-history options remain available.
- Added the requested small highlight box to explain the start and how to find earlier results. Desktop dismissal is stored for this announcement only.
- Desktop coverage includes Home, personal history/stats, community reports, matchup preparation, deck performance and insights, private hubs/teams and replay libraries. Nested matchup matrices inherit their parent-selected cohort.
- Website coverage includes community reports, deck/legend/player detail and comparison pages, public profiles, team profiles, Meta Studio and replay libraries. Homepage current-meta data uses Radiance; lifetime counts remain explicitly labelled.
- Lists and derived stats share the selected cohort. Season and date filters intersect. Empty cohorts keep the season selector visible.
- Classification prefers recorded match time over upload time. An invalid recorded date is excluded from specific seasons; upload time is only a fallback when recorded time is absent. Date-only history is treated as midnight UTC, so a date without an exact time on 10 October is not assumed to follow the afternoon cutoff.
- Explicit website `season=` preserves All seasons; missing season defaults to Radiance. The legacy desktop community API keeps omitted-season responses unfiltered for older desktop clients.
- No stored match histories are reset or migrated. Statistics still reflect each surface's existing available-history window; this change does not expand backend retention.

## Training and session scope

Mulligan Lab and Sideboard Lab practice pools still use all available history. Their existing v2 anonymised training facts store dates without precise times and their wire format has a fixed 31 July split. It cannot truthfully represent this afternoon cutoff without a separate schema migration/backfill. Visible descriptions now say all available history, and the historical comparisons explicitly say before/since 31 July 2026. Do not relabel those training facts as Radiance. Stream-session totals and operational sync/upload counters remain scoped to their sessions/tasks.

Opening Turns Lab and Replay Coach remain Coming soon; no parked feature was enabled.

## Validation

Desktop: TypeScript, **2,798 tests in 248 files**, and **82 account-sync checks** passed. Actual announcement/filter browser fixture verified empty Radiance, selecting archived matches, persistent dismissal, and layouts at 1280×720 and 390×844. Initial suite failure was two source-text assertions for the deliberately clarified training copy; those expectations were updated and the full suite passed.

Website: full suite **1,552 passed / 9 skipped** (177 passed files / 1 skipped), followed by **63 passing focused checks** including four additional navigation/empty-state regressions. Final TypeScript and scoped ESLint passed (two pre-existing team-page image warnings). Actual CommunityFilterBar and QueryDateFilter browser fixtures verified one Radiance row at the boundary, the earlier Vendetta row, explicit All seasons preserving both rows, desktop layout and mobile profile filters. Website browser evidence: `output/playwright/radiance/community-desktop.png` and `profile-mobile.png`. Final link/date/empty-state regression results are recorded in the local output receipt.

Desktop evidence: `output/radiance-preseason-20261010/` and `output/playwright/radiance-preseason-20261010/`. Baseline patches/hashes are recovery references only; changes are already in the worktrees. `preservation-audit.json` records unchanged heads/refs and preserved unrelated files. Website `next-env.d.ts` SHA256 remains `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`.
