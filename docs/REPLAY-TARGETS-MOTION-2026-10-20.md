# Recorded targets and clearer card movements — 20 October 2026

Local website source changes for the user's requested replay clarity improvements. No deployment, desktop rebuild, version bump, production replay reprocessing or account writes.

## Behavior

- Atlas manually drawn arrows now appear from captured `targetArrowsByPlayer` room state. Mint identifies the capture player's arrows; orange identifies the opponent's. Arrows support board and chain cards, bases and battlefield markers. A compact key appears only while visible arrows exist.
- Arrows follow the projected state when playing, pausing, seeking or changing perspective. Authoritative removal/clear owns their lifetime. BO3 transitions clear earlier-game arrows; legacy checkpoints cannot revive unsupported carryover. Existing spell-chain/what-if target behavior remains separate.
- Confirmed card moves into trash and runes returned to their rune deck receive a brief 480 ms movement, scaled with playback speed. Explicit `zone_move`, or unambiguous same-action `zone_remove`/`zone_insert`, supplies the evidence. No movement is inferred from logs or arbitrary snapshots.
- Hidden/private cards remain card backs while moving. The animation uses the previous rendered appearance, never future card knowledge. Missing or ambiguous geometry skips the effect. At most eight exit visuals are active.
- Initial deep links, scrubbing, backward steps, setup, resyncs and BO3 transitions do not create phantom movements. Forward action stepping can animate. Pausing retains the current frame; resume finishes it. Reduced-motion preferences suppress the new flight effects while leaving static targeting arrows visible.
- Follow-up: each player's rune rail now shows **Active runes N / total**. Active means unexhausted runes in the current `runeArea`; the total includes exhausted runes in play and excludes the rune deck. The count follows playback, seeking and perspective using canonical card readiness, with an explanatory tooltip and a player-specific accessible label.

## Compatibility

Existing canonical Atlas snapshots and room-field patches already retain the arrow data, so existing recordings containing it benefit without reprocessing. A replay that never captured targeting data cannot reconstruct missing arrows. No capture, transport, live Atlas page or desktop startup behavior changed.

The official public Atlas source audit is preserved in the desktop worktree's `output/atlas-startup-client-audit-20261020/`: `manifest.json` records URLs/hashes; `03azfb7rltdws.js.pretty.txt` defines the room arrow schema; `35_5a-hj_uv52.js.pretty.txt` defines supported anchors, the 20-per-player bound, and authoritative add/remove/clear behavior. No presence-message coordinates or invented expiry were introduced.

## Verification

- Full website suite: **1,763 passed, nine skipped**, across 193 passing files and one skipped file.
- TypeScript passed for application source, scripts and root configuration using the output-local check config. It excludes archived release source copies under `output/`, which the repository's broad default config otherwise includes.
- Scoped ESLint and `git diff --check` passed.
- Added regressions cover target schema/privacy, authoritative clearing, BO3/legacy seeking, parent-ref mounting, perspective changes, pause/resume positioning, movement evidence, hidden cards, bounded work, speed and cleanup.
- Fixed one pre-existing nullable `gameId` in an account-review test fixture with an explicit fixture assertion so the source type check is valid; no account behavior changed.
- Actual-player browser fixtures at 1920×1080 and 1280×800 verified both perspectives, six movement cases, hidden backs, initial deep links, forward/backward steps, 4× playback, reduced motion, pause/resume, authoritative clear and seek restoration. No uncaught JavaScript errors. Synthetic local artwork/accounts only; no production writes.
- Active-rune follow-up: 73 existing player/projection tests, application TypeScript and scoped ESLint passed. Browser evidence for the counter is under `output/playwright/active-runes-20261020/`.

Evidence and local preview: `output/playwright/replay-motion-20261020/`. The isolated preview listens at `http://127.0.0.1:4236/?t=4`; its 40-second synthetic timeline shows targets at 4/8 seconds, trash at 12/20 seconds, rune recycling at 16/24 seconds, hidden-card trash at 28/32 seconds and clearing at 36 seconds. `preview.mjs` can rebuild/restart this fixture. Existing preview scripts are preserved.

The pre-existing dirty `next-env.d.ts` bytes remain SHA256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`. The existing desktop worktrees, installers, live deployment and saved reviews are unchanged.

## Published — 21 October 2026

The user subsequently authorized publication. These features are now live from `c910a13b6f5e68d5ba8f84eb34bd08669e7108be`, deployment `dpl_6PQbwc9WzjZFDVGCPurEg1bnc4F1`. This supersedes the local-only status above. See [the publication receipt](./WEB-RELEASE-2026-10-21.md) for release validation.
