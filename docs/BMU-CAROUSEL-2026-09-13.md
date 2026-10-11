# BMUCasts first in the creator video carousel

## Local long-form-only follow-up — 11 October 2026

Automatic creator picks now read YouTube's regular Videos playlist (`UULF` plus the channel ID suffix), so Shorts cannot displace regular uploads or consume the recent-feed window. The Atom parser also rejects matching `/shorts/` alternate links in every source mode, including manually selected playlists, pins and inclusion exceptions. The Studio copy explains the long-form-only policy. No duration, title hashtag or thumbnail-dimension heuristic is used.

Snapshots have a new format-policy source key, preventing a pre-change snapshot from bringing Shorts back during a feed outage. Existing creator weights, BMUCasts-first ordering, topic filters and exclusions remain supported. This changes the website feed consumed by desktop Home; no desktop code changed.

Live, read-only YouTube checks found the two newest BMUCasts entries were Shorts (`uAYJQqWF6Cc` and `iPV7_Mw-zbs`). The revised service instead selects [Riven Rules You Need to Know](https://www.youtube.com/watch?v=74e7U7PjkzA). Videos-only feeds responded successfully for all 14 configured channels. Evidence: `output/creator-long-form-20261011/verification.json`. This follow-up is local source only, not deployed.

Validation: 71 focused feed/config/API/Studio tests, full-project and source TypeScript, and scoped ESLint passed. The tests cover regular-video selection after newer Shorts, all source modes and manual overrides, legitimate videos mentioning Shorts, feed outages, current snapshots and rejection of legacy mixed-upload snapshots. Studio marks Shorts as excluded without offering an ineffective inclusion override.

## Original implementation — 13 September 2026

Local source change, 2026-09-13. Not deployed; no installer rebuilt.

The desktop Home carousel consumes the website's `/api/app/home` feed. BMUCasts is now a one-slot source, with its latest eligible upload reserved before manual video pins and the weighted creator rotation. New uploads replace that opening video automatically. Exclusions, disabled channels, the carousel switch, deduplication and other creators' allocations remain supported.

Verified the supplied [BMUCasts channel](https://www.youtube.com/@BMUCasts) against its public channel metadata and RSS feed: `UC58pT3YSehFcosxeQqz4nqA`. At verification, the latest RSS entry was `0Okn73Di2BQ`, “Master Yi vs Annie - Riftbound online gameplay”. The implementation uses the channel feed, not that fixed video ID.

Home and Meta Studio reads add BMUCasts to older saved nonempty rosters in memory. Existing profiles, overrides and exclusions are retained. The former standard limit of 17 expands to 18 when adding the missing channel; custom limits, empty rosters and explicit disablement are retained. Saving the resulting configuration through Studio persists it normally. No Firestore documents were changed during this task.

Changed source: `src/lib/youtube/creator-video-config.ts`, `creator-video-feed.ts`, `src/app/api/app/home/route.ts` and `src/app/api/meta-studio/creator-videos/route.ts`, plus their four test files.

Validation: 4 files / 51 focused tests passed; `tsc --noEmit --incremental false` passed. Coverage includes new-upload replacement, priority over other pins and weights, exclusions, unavailable/disabled channels, deduplication, all 18 default slots and saved-config compatibility.

Release note: this is a shared website-feed change. It needs an authorized website deployment before installed desktop clients receive it on their normal feed refresh; it does not require a desktop installer update. Prepare that deployment from the current production baseline, preserving the existing Results Bot and Atlas replay-deck releases. Do not deploy this older development worktree wholesale. Existing live takeover behaviour and bundled offline video fallback are unchanged.
