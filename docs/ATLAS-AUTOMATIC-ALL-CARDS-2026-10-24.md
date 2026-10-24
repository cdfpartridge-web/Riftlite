# Automatic Atlas post-game cards

**Website published 24 October 2026:** The user explicitly authorized deployment for real-game testing. Runtime `197d0e43dcf5d1e428dbf034a0cf8947cff08c31`, deployment `dpl_5u36hqwVXeNT77d77cspwEXKQ7JB`, is live at www.riftlite.com. See [publication and validation](./WEB-RELEASE-2026-10-24-ALL-CARDS.md). The desktop collector remains in the latest local test installer; the public desktop release was not changed. Restart that local build to reset any retries exhausted before the endpoint existed, then leave Atlas signed in at its lobby. Real authenticated attachment remains for the user's test.

The user requested automatic collection after an Atlas match, preserving RiftLite's opening capture and adding an All cards view. Manual JSON import is a secondary recovery option, not the normal workflow. The initial implementation was authorized for local rebuild only; the later website deployment authorization and outcome are recorded above. No desktop release, version bump, installation or real-profile operation was included.

## Viewer and storage

- Player view remains the default. All cards is an identity-only projection of exactly matched Atlas frames; it never replaces the canonical timeline, captured opening, original privacy flags, or note/event positions. Presentation opening scenes retain Player view. Unmatched positions fall back to the captured state.
- Canonical capture room, participants, game times/number, sequence and exact card-instance/board positions must match. No nearest-timestamp guessing. A completed duel with restricted/placeholder information cannot enable All cards. BO3 exports must explicitly identify their game number.
- `/api/v2/replays/:replayId/atlas-postgame` keeps compact, sanitized per-game artifacts separately. GET `?metadata=1` returns small access-filtered metadata; normal GET adds allowed exports. PUT is owner-only with expected account and previous hash. PATCH shares one explicit current game/hash; imports and replacements start private. Existing identical data retains its sharing choice.
- Original replay access still gates shared imports. Private supplements are absent from other viewers' metadata and never enter browser storage. Account/session changes clear projected information and inspected cards. Private review notes are untouched.
- The All cards source is post-game Atlas data, not a dual-player-consent capture. Existing combined replay and known-only Cards up behavior remain distinct.

## Automatic desktop collection

The desktop queues recent, successfully uploaded Atlas captures only while Interactive replays and their capture-time account consent remain enabled. It derives exact completed game keys from existing persisted authoritative messages, waits for BO3 series completion, and uses the signed-in Atlas page's current auth endpoints. Tokens remain within the Atlas page.

A 15-second quiet gate blocks work during startup activity, active capture, another provider's match, matchmaking or page loading. An incoming trusted room/matchmaking signal cancels the guest request. Query, raw-file read and delivery stages recheck the idle gate and account/capture identity. The finite queue makes at most three game requests per pass, with bounded retry/backoff and a six-hour capture age limit. It adds no live WebSocket tap or live polling in the game page.

Original replay upload succeeds independently. The supplement is attached only afterward; an existing supplement is skipped instead of overwritten. Collection failure does not mark the original replay as failed. Captures and live gameplay never consume the post-game information.

## Validation and test limits

Both user-supplied exports decode and survive the emitted desktop query → website decoder roundtrip with mocked auth/network: 284 and 329 frames, approximately 708 KB and 824 KB sanitized compact data. Neither export contains opening/mulligan frames. Exact matching against the user's original normal RiftLite capture is not demonstrated by these Atlas-derived demos; a separate synthetic fixture checks opening preservation and BO3 tests check game isolation.

The local test site at `http://127.0.0.1:4242/?t=3` runs the actual viewer and desktop queue with isolated demo accounts and mocked Atlas delivery. Choose Demo Alice, Simulate finished-game sync, then All cards. The top-level simulation button is test tooling only. Nothing is uploaded to production. See `output/atlas-postgame-local-20261024/automatic-simulation-check.json`, `api-check.json`, build logs and `output/playwright/atlas-automatic-all-cards-20261024.png`.

Focused validation covers decoder limits, exact matching, immutable opening projection, account changes, stale sharing, ownership and ACL revocation, deleted replay cleanup, idle/cancellation behavior, pending/error handling and automatic delivery. The full website run passed 1,836 tests with nine skipped and one clip test timeout under concurrent build load. A selected-card reset exposed by the isolated player suite was fixed; its full 66-test rerun passed. Final additional player/hook verification and build are recorded in the local output receipt.

The original `next-env.d.ts` bytes are preserved (SHA256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`). Historical ignored `output` snapshots contain stale TypeScript sources, so local production-build validation excludes that directory temporarily and restores the exact tsconfig afterward. They are not deleted or rewritten.

Final source checks passed: 72 player/hook tests (20-second per-test allowance while packaging/build work ran concurrently), scoped ESLint with zero warnings, scoped TypeScript, and the final Next production build including the new route. Browser QA confirmed four hidden opponent cards become visible in All cards and hidden again in Player view, private imports disappear for another account, and explicit sharing makes them available to that viewer. The separate automatic simulation passes both supplied games and the synthetic opening fixture. The desktop full gate passes 3,000 tests plus 82 account checks.

## Original local validation boundary

The automatic desktop installer uses the fixed production RiftLite API. The separately required website endpoint is now deployed as recorded above. No authenticated Atlas request or production attachment was performed by the agent. The local simulation is not a live end-to-end sign-in test. Public Windows/Mac v0.9.86 remains unchanged.
