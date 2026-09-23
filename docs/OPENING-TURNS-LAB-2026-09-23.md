# Opening Turns Lab — 23 September 2026

The user requested anonymous public and unlisted replay openings on an interactive drag-and-drop gameboard, then explicitly chose **Desktop Training only**. This implementation adds a desktop lab backed by the existing Web Replay player. It does not add a website navigation item. The user subsequently authorized a local desktop rebuild and deployment of the supporting website changes. The desktop version remains 0.9.76; this is not a new public desktop release.

## Checkout and integration

- Website feature checkout: `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/RiftLite/.codex-worktrees/opening-turns-lab-20260923`, branch `codex/opening-turns-lab-20260923`, based on released website receipt `701f975`.
- Desktop checkout: `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/Riftlite Beta 0.6/desktop-v06`, branch `hotfix/atlas-shell-recovery`, public version remains **0.9.76**.
- Desktop entry is **Prepare → Opening Turns Lab**, alongside Mulligan and Sideboard Labs. The current desktop sidebar groups Training under Prepare.
- Hosted desktop surface: `/app/opening-lab`; API: `/api/opening-lab`. The surface has no site header/footer, ads or page-view tracker and carries noindex metadata. It can be viewed directly for local review; it is not an authenticated desktop-only access control.
- Desktop uses a dedicated ephemeral `riftlite-opening-lab` partition, sandbox/context isolation/web security enabled, no preload or Node integration, all permissions denied, no popups and navigation pinned to the training path and original origin. Only development accepts fixed loopback port 4201.

## Learner experience

Choose a legend and optionally an opposing legend. A complete captured game supplies five of the learner's own turns. Each decision starts before the first strategic action, including resource payment, after captured automatic setup. Drag cards between zones, exhaust runes, adjust counters and scores, add cards/targets to the chain, undo, redo or reset with the existing replay controls.

Locking preserves the learner's actual edited position locally and reveals the recorded continuation, including the opponent response through the next decision. Compare **Recorded play** with **Your position**, then continue. The next turn returns to the original recorded game. After turn five, finish or start another opening.

This is manual, ungraded practice. It has no rules engine, automatic card effects/payment, best-move evaluation or simulated opponent response to a counterfactual line. The selected legend uses real recorded decks, not the user's saved active deck. Attempts are transient; there is no account progress sync or all-turn archive in this first version.

## Data boundary

- Only ready **public** and **unlisted** records enter the shared pool; private is excluded. Current visibility and canonical revision are rechecked on every start/reveal, even for cached artifacts. Source games retain their original visibility.
- Server projects canonical events and requires five complete early turns, known learner hand identities, valid initiative, sequential turns, clean decision anchors and actual completion boundaries. It rejects mid-game starts and truncated fifth turns.
- Browser responses are **new allowlisted snapshots**, not raw provider JSON with names redacted. Player/card/event IDs are replaced; names are You/Opponent. Registry card identities, zones, numeric gameplay fields and remapped attachments/chain references are retained. Unknown/provider metadata, usernames, avatars, account IDs, room codes, raw IDs, timestamps, source links, results, logs, chat, checkpoints and diagnostics do not cross the boundary.
- Opponent hands, both decks/sideboards and opponent face-down cards remain concealed, including paired-source identities. Future-hand inference is disabled for editable practice. Each question contains exactly one pre-decision snapshot; reveal is physically limited to that decision window.
- Session tokens encrypt source ID/revision/game/step/expiry using AES-GCM, with a domain-separated key from the existing `REPLAY_EMBED_SESSION_SECRET`. Tokens expire within two hours. Source IDs are not recoverable by base64-decoding the browser token.
- API bodies are limited to 4 KiB; JSON and same-origin checks apply. Responses are private/no-store. Unexpected errors and logs do not contain source paths/IDs. Storage failures return retryable 503 responses, distinct from no eligible opening (404).

## Operational limits

The initial implementation queries at most 1,500 public/unlisted metadata records, caches metadata for two minutes, and checks up to 20 shuffled candidates for a requested matchup. The UI discloses a limited pool when the query reaches its cap. The process holds at most six canonical artifacts. No new Firestore index, schema migration or production write is needed. Hosting needs the existing Firebase Admin, private Blob storage and replay-session secret configuration.

## Local preview and evidence

`node scripts/opening-lab/preview.cjs` serves `http://127.0.0.1:4201/app/opening-lab` from the website checkout, using `output/opening-lab/fixtures.json`. The manifest points at an existing real Shen, Eye of Twilight versus Mel, Soul's Reflection canonical capture in the preserved Baron worktree. It supplies two eligible five-turn game openings. The local manifest labels the fixture unlisted to exercise that eligibility path; it does not assert or alter the original source visibility. Fixture loading is disabled in production. The preview creates an ephemeral token secret if none is supplied.

For desktop development, set `VITE_OPENING_LAB_URL=http://127.0.0.1:4201/app/opening-lab`. Production builds ignore that override. Isolated native verification files are under the desktop checkout's `output/opening-lab-native/`, with their own compiled main/preload output and smoke profile. The installed app's profile and public artifacts were not used or changed.

Browser evidence is in `output/playwright/`: real card drag, undo/redo, preserved comparison, recorded playback, next-turn progression and five-turn completion. Native smoke verified the desktop entry, five-card editable hand, correct origin/partition and absence of Node/app bridge. Its network isolation deliberately blocks external card-art requests, so use the browser preview for visual review.

A read-only live catalogue query succeeded, but local environment files have no `BLOB_READ_WRITE_TOKEN`, so direct live artifact verification cannot pass locally. The deployed website's storage configuration must be checked during release acceptance; no production configuration was changed.

## Verification receipt

- Full website suite: **159 files passed, 1 skipped; 1,262 tests passed, 9 skipped**. After the final storage-error and training rewind changes, all **111 tests across six relevant suites passed**, including the complete existing replay-player and analysis suites.
- Full desktop suite: **234 files, 2,579 tests passed**. Renderer/Electron TypeScript checks passed; native smoke verified the real menu integration and isolation.
- Website TypeScript and lint of all changed/new feature modules passed. **Next.js production build passed**, including `/app/opening-lab` and `/api/opening-lab`. Receipt: `output/opening-lab/production-build.txt`. The first local build invocation hit Node's unsupported inherited `--env-file` option; loading environment values before spawning the build resolved the tooling issue without changing product code.
- Browser: real Shen–Mel positions, card drag/undo/redo, preserved attempted position, recorded playback, next-turn transitions and the five-turn completion screen.

## Release acceptance

Deploy this website branch before distributing a desktop installer that points at the new route. Verify the production catalog and a complete five-turn flow with the existing storage/session configuration. Unlisted eligibility and visibility revocation have automated coverage; any live source audit must remain read-only. Package desktop in a separate local output directory under the user's rebuild authorization. Preserve the desktop's unrelated local Web Replay recovery fix and all other dirty/untracked work. Record the completed deployment and installer acceptance below.
