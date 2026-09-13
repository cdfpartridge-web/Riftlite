# BMUCasts first in the creator video carousel

Local source change, 2026-09-13. Not deployed; no installer rebuilt.

The desktop Home carousel consumes the website's `/api/app/home` feed. BMUCasts is now a one-slot source, with its latest eligible upload reserved before manual video pins and the weighted creator rotation. New uploads replace that opening video automatically. Exclusions, disabled channels, the carousel switch, deduplication and other creators' allocations remain supported.

Verified the supplied [BMUCasts channel](https://www.youtube.com/@BMUCasts) against its public channel metadata and RSS feed: `UC58pT3YSehFcosxeQqz4nqA`. At verification, the latest RSS entry was `0Okn73Di2BQ`, “Master Yi vs Annie - Riftbound online gameplay”. The implementation uses the channel feed, not that fixed video ID.

Home and Meta Studio reads add BMUCasts to older saved nonempty rosters in memory. Existing profiles, overrides and exclusions are retained. The former standard limit of 17 expands to 18 when adding the missing channel; custom limits, empty rosters and explicit disablement are retained. Saving the resulting configuration through Studio persists it normally. No Firestore documents were changed during this task.

Changed source: `src/lib/youtube/creator-video-config.ts`, `creator-video-feed.ts`, `src/app/api/app/home/route.ts` and `src/app/api/meta-studio/creator-videos/route.ts`, plus their four test files.

Validation: 4 files / 51 focused tests passed; `tsc --noEmit --incremental false` passed. Coverage includes new-upload replacement, priority over other pins and weights, exclusions, unavailable/disabled channels, deduplication, all 18 default slots and saved-config compatibility.

Release note: this is a shared website-feed change. It needs an authorized website deployment before installed desktop clients receive it on their normal feed refresh; it does not require a desktop installer update. Prepare that deployment from the current production baseline, preserving the existing Results Bot and Atlas replay-deck releases. Do not deploy this older development worktree wholesale. Existing live takeover behaviour and bundled offline video fallback are unchanged.
