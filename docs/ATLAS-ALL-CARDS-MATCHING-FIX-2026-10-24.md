# Atlas All cards attachment correction — 24 October 2026

The owner tested a new completed Atlas game after the All cards website deployment, but All cards remained disabled. Read-only inspection of the original capture confirmed a Ready upload, current account consent, active local parents and one valid completed-game target. Production request logs, correlated to that replay in memory without exporting its identifiers, showed six attachment PUT requests returning HTTP 409. The desktop reached website delivery and exhausted its six-attempt budget.

## Cause and correction

Atlas live capture represents private card slots with IDs such as `__hidden_zone__:player:hand:0`. Its completed full-card export contains actual card IDs. The previous matcher required identical IDs for every card, so a genuine masked capture could not align with the completed export. Earlier fixtures normalized full-card exports and did not reproduce these masked IDs.

The matcher now recognizes only validated blank placeholders in private zones, with exact player, zone and slot indices and equal zone lengths. It requires the exact game-history start, authoritative sequence and at least two matching public card identities. Existing room, participant, game, board, resource, status and chain checks remain in force. Arbitrary mismatched IDs are still rejected. The projection enriches only the matched position, preserving original IDs, opening capture, events and review anchors. Original Player view is unchanged. Attachment ownership and optional sharing remain unchanged; additional card data is private by default.

Synthetic regression tests use the observed masked-slot structure, not private user replay payloads. Validation and deployment receipts are recorded in `output/all-cards-greyed-20261024/`. The real owner upload remains a user retest; do not report it as verified solely from fixtures or anonymous HTTP checks.

Validation before deployment: the new masked-slot regression failed against the old matcher; 64 core/server tests passed after correction, and 16 additional account-hook/player-panel/review tests passed. The server regression exercises production raw normalization, decoder, matcher and the PUT route, returning 200 with `available: true` while denying anonymous private attachment data. Scoped lint passed with zero warnings. TypeScript passed with historical `output/` snapshots and untracked local demo scripts excluded; the unrestricted worktree check was stopped after it included thousands of archived source files. The isolated deployment build provides the production compilation check. Independent matcher review found no remaining blocker. Desktop source checks passed TypeScript and 95 relevant tests; no desktop artifact was rebuilt.

## Retry and scope

After the corrected website is live, the owner can fully quit and reopen the existing local desktop build, leave Atlas signed in at its lobby briefly and reopen the same Ready replay. Restart resets the exhausted in-memory collector budget; a new game is not required while the completed capture is within the six-hour collection window.

Independent desktop source fixes also prevent connection housekeeping from continually resetting the post-game quiet period and allow collection on the native Atlas replay route. Collection diagnostics now identify a failed stage using fixed enums/counts without tokens, payloads or player IDs. Those desktop changes are local source only, not part of this website deployment or a new installer. The reported game's successful requests show those gates were not its blocker. No public desktop release, version change, installation or profile mutation is included.

The preceding website runtime is `197d0e43dcf5d1e428dbf034a0cf8947cff08c31`, deployment `dpl_5u36hqwVXeNT77d77cspwEXKQ7JB`. Preserve this rollback candidate and the desktop lag improvements. Preserve the website's pre-existing `next-env.d.ts` bytes and local demo scripts.
