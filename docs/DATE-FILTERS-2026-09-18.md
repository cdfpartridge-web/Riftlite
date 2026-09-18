# Website date filters — 18 September 2026

## Authorized release preparation

The user subsequently requested a local Windows rebuild and website publication. This release checkout `date-filters-release-20260918` starts from verified live replay-sounds source `92f11454eea65d90ef5c22b48597d574f32ebecc`, deployment `dpl_Dnwja3cnCzHHFjrPBnbjnCgdyzMH`. Only the date-filter changes below are applied; previous Results Bot, BMUCasts and replay-sound releases remain intact. Unpublished development features remain in their original checkout.

The isolated release passes **154 test files / 1,208 tests**, with the existing 9 emulator-dependent tests skipped, full TypeScript and targeted ESLint (zero errors, three existing warnings). Logs are under `output/date-filters-release-20260918/`. The earlier local-work record follows; publication verification is appended after promotion.

Local source changes only in `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/RiftLite/.codex-worktrees/zelonius-web-20260826`. No website deployment, source commit/push, version bump, installer build, or production data mutation. Existing bot, artwork, replay, sound, release-label and Your Move work is preserved.

## Behavior

- Specific date and inclusive date-range controls now cover community match history, deck list, legend meta, matchup matrix, legend/player/deck detail and deck comparison.
- Public user profiles scope their headline totals, deck count, match explorer and replay cards together. Public team profiles scope totals and their match explorer together.
- Public, owner and desktop-embedded Web Replay libraries filter by recorded date, falling back to upload date when no capture date is available. Loaded results and Load more stay accessible when a date has no matches.
- Admin Meta Studio also supports explicit dates, with honest retained-history coverage and comparison availability; its implementation is covered by the parallel Meta Studio audit.
- Existing quick periods remain available. New local-calendar presets, single dates and ranges respect inclusive day boundaries and DST. Existing community Last 24 hours/7/14/30-day source windows preserve their current semantics.
- Shareable server queries include the viewer's IANA timezone. Date drilldowns retain period, bounds, timezone and explicit season/format; paging and search are not copied. Applied timezone is shown, including when it differs from the viewer's timezone.
- Invalid, incomplete and reversed ranges show an error and do not produce unfiltered results. Clear dates also clears unapplied drafts. Unknown dates are included only for unrestricted history.
- Recorded match date takes precedence over record creation/upload time. Empty matches clear stale detail selections. Profiles that expose stats but keep match history private report dated statistics as unavailable rather than inventing zeroes.

## Data coverage and privacy

Dates filter available records; they do not promise a new full historical archive. Community specific dates use the deduplicated union of the latest 7,000 records and existing cached 30-day detail windows. Older dates may have no retained records. The UI explicitly states this limit. Profile/team data retain their existing source windows; public replays retain pagination and owner replays retain their existing loaded window. No raw Firestore scans, wider visibility, new owner identity access or private-hub membership changes were introduced.

Account management, hub membership/invites/chat, operational upload queues and the local Your Move editing catalogs are not historical statistics and are unchanged.

## Supporting fixes

- The browser exposed a real existing failure: the 30-day detail payload is about 20 MB, above Next's 2 MiB per-entry data-cache limit. Detail windows now use a bounded, coalesced in-process cache with the existing 30-minute TTL and invalidation generation. Only the three fixed range keys exist; small precomputed statistics retain the existing Next cache. Tests cover oversized payloads, coalescing, TTL expiry, failed-load retry and invalidation during an in-flight read.
- Applying an explicit All seasons selection previously deleted the query field and reinstated the default season. Empty season is now preserved, including drilldown/back links.

## Local validation and preview

The local Next development site is running at http://127.0.0.1:4195/ (Webpack; supported for this junctioned worktree). Example: `/community/meta?season=&range=date&from=2026-09-18&timeZone=Europe%2FLondon`.

Verified with the actual local site: specific date results, date-preserving legend drilldown with the same 35-game sample, invalid range feedback/disabled Apply, mobile layout without horizontal overflow, an empty future date, and Clear dates restoring available history. After the cache fix there are no new browser console errors; existing AdSense/image warnings remain. UI tests also exercise replay capture-vs-upload date, empty-date pagination, date reset, profile privacy and URL preservation.

Screenshots: `output/playwright/website-date-filters-range-20260918.png`, `output/playwright/website-date-filters-mobile-20260918.png`. Test log: `output/date-filters-tests-20260918.log`; typecheck log: `output/date-filters-typecheck-20260918.log`.

Consolidated validation at 12:23 BST: **23 files / 158 tests passed**, including Meta Studio server/routes/client checks. Full website TypeScript passes (`tsc --noEmit --incremental false`). Changed-file ESLint has **zero errors**, with three pre-existing warnings (two team images and an unused DeckCard import).

Meta Studio Canvas subsequently passed **6 component tests** and targeted ESLint. Explicit dates use draft inputs plus Apply, show the timezone of the applied report, keep controls available for empty reports and label retained-history limitations. Invalid drafts do not request data or relabel existing results. Cancelling an unapplied draft resets locally without triggering a redundant request/stuck loading state. Its additional toolbar row was inspected against the existing flexible canvas layout; the private authenticated page was not exercised live.

Generated `next-env.d.ts` preview changes were restored to the clean starting content. Pre-existing `tsconfig.tsbuildinfo` changes were preserved. The `/players` and `/teams` directory audit found no additional historical reports to filter. No production build/deploy or installer rebuild was performed.

## Published 18 September 2026

- Immutable runtime source: `56c4fa42a03ae1656b7e00d2708778084299b34b`, branch `codex/date-filters-release-20260918`.
- Deployment: `dpl_3yCXeDFRNBjy44Ks5XxaiELTTVAh`.
- Immutable URL: https://riftlite-jdxzt7h5n-cdfpartridge-3985s-projects.vercel.app
- Promoted to https://www.riftlite.com and verified live at **14:11 BST**.
- Rollback deployment: `dpl_Dnwja3cnCzHHFjrPBnbjnCgdyzMH`, runtime source `92f11454eea65d90ef5c22b48597d574f32ebecc`.
- Production build passed. **17 candidate and 17 live HTTP checks passed**, including all community date pages, invalid ranges, empty-date recovery, replay library controls, Meta Studio authorization, owner-only deck attachments, approved audio hashes, BMUCasts-first feed and Results Bot signature checks/privacy disclosure.
- Live Chromium interaction verification passed **9 checks**: invalid-range feedback/disabled Apply, applied bounds, preserved All seasons, date-preserving legend drilldown, retained detail inputs, clearing an empty future date and mobile width. Desktop/mobile screenshots were inspected. No browser errors; only the existing AdSense warning.
- Evidence: `output/date-filters-release-20260918/`, including deployment/production inspection, tests, HTTP receipts, browser script/log and screenshots. The first HTTP script checked the `/replay` redirect shell; the corrected check verifies the canonical `/replays` library.
- The isolated release retains previously published functionality. Development source and all unrelated local features were preserved. No Git remote push or application-data write was required.

The separately requested local Windows installer is `desktop-v06/output/local-date-filters-20260918-135923/RiftLiteBetaInstall.exe` (v0.9.75, 159,375,892 bytes, SHA256 `74BA21FEC2178438B0EB6F044A44FA970774B03DA75C139A4DB03297D5FDD3EB`). It is not installed or published; public Windows/macOS installers remain unchanged.
