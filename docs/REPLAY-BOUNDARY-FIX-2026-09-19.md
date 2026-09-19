# Atlas previous-room replay boundary fix — 19 September 2026

## Status

Implemented and verified locally; website deployment and targeted recovery were subsequently authorized by the user's "Deploy the fix" request. Production candidate verification and promotion are in progress. The completed release receipt will be appended below. No desktop installer rebuild is included.

Website fix workspace: `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/RiftLite/.codex-worktrees/replay-boundary-fix-20260919`, branch `codex/replay-boundary-fix-20260919`, based on release documentation commit `ef43bbc54d5eda36bb850eba6428ae425ed707f7`. Only the parser fix, its helper, synthetic regressions and this receipt are included in the release. The older mixed website development checkout was not edited.

Desktop prevention is uncommitted in `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/Riftlite Beta 0.6/desktop-v06`, alongside the preserved existing date-filter work.

## Confirmed failure

The tester's diagnostic JSONL identifies a later successful BO3. A narrow read-only lookup using that match's ID and room identified its replay and the same owner's September 18 failed Atlas replay with the exact duplicate-boundary error. Both retained raw artifacts were downloaded privately and verified against their stored SHA-256 and size. No production records, visibility, artifacts or messages were changed.

The failed raw file contains 2,907 transport messages. A stale unnumbered in-game snapshot from a predecessor room is followed by a new room's explicit Game 1 lobby. That lobby declares a new series and references the predecessor through `previousRoomCode`. The desktop interpreted this return-to-lobby link as a BO3 continuation and merged the old snapshot into the new capture. The website then inferred games `1, 2, 1, 2` and rejected publication.

This is not the initial hypothetical repeated-result cause. The retrieved raw file establishes a previous-room preamble as the cause.

## Changes

- Desktop `rawCaptureService.ts` rejects merging a fresh, explicitly identified Game 1 in a different room into the prior session. The existing raw capture remains available separately. Same-series BO3 room transitions and identity-free continuation preambles remain supported.
- Website `atlas-series-scope.ts`, called by `parse-raw-capture.ts`, scopes an older capture only when its declared series identity agrees with an incoming explicit Game 1 lobby, that lobby names the preceding room, and an earlier in-game snapshot proves the stale preamble. Contradictory room/series evidence or later reuse of the predecessor room prevents this repair. Raw source messages remain intact; original packet source indices remain intact; an explicit diagnostic records the exclusion.
- Duplicate-game publication rejection remains enabled. Missing identity, an absent lobby reset, unrelated predecessors and genuine same-series game history are not silently discarded.
- Regression coverage uses synthetic fixtures only. Private tester captures are not committed or copied into tests.

The real failed capture now yields games `[1, 2]`, with both recorded game results restored from its desktop metadata. Its overall series remains incomplete at 1–1; no Game 3 or match winner is invented. Its normalized replay passes all publication checks. The later successful `[1, 2, 3]` replay is byte-for-byte unchanged after normalization.

## Verification

- Website: **155 test files passed, 1 skipped; 1,220 tests passed, 9 skipped** (existing emulator-dependent skips).
- Website TypeScript and changed-file ESLint passed.
- Desktop: **227 files / 2,479 tests passed** with four workers. The initial parallel run had one pre-existing journal-burst test exceed its five-second timeout; the complete rerun passed without changing that test or its timeout.
- Desktop renderer and Electron TypeScript checks passed.
- The real failed capture reproduced the original error against the release baseline and passed against this fix. Timeline ordering, all checkpoint hashes and checkpoint seeking versus sequential projection were checked for both real captures.
- Successful-capture canonical SHA-256 is unchanged: `2ef3f558fc5ec0acc03c204c78beb81b60d002211519faf1d92e6de6be5fa130`.

Private operator lookup receipts are under `C:/Users/cdfpa/OneDrive/Documents/Claude/Projects/RiftLite/output/replay-boundary-fix-20260919/`. Real raw captures and local verification receipts are in this website worktree's ignored `output/` directory. Keep these private. The temporary downloaded production environment file was removed after retrieval.

## Release and recovery follow-up

The website fix must be deployed before installed clients benefit from this compatibility repair. Desktop prevention requires a separately authorized installer rebuild/release. Preserve the current release, worktrees and all unrelated dirty files.

The existing failed server record caches a non-retryable capture failure. Deploying the parser alone will not automatically reprocess that record. A future authorized recovery should use the exact failed record and immutable raw pointer recorded in the private lookup receipt, verify they have not changed, and perform targeted reprocessing through the normal completion pipeline. Do not broadly clear failed records or enable an incomplete-capture override; no production recovery was performed here.
