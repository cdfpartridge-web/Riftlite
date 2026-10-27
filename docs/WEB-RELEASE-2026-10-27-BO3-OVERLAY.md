# BO3 All cards and battlefield overlay — 27 October 2026

**Live at 15:09 UK:** runtime `e9f29e520cd90d5aee047f2b3656df793e2d0725`, deployment `dpl_9SZLq6FdN5eCx2UzSMKvoLpCsxVi`, on https://www.riftlite.com. The clean source archive SHA256 is `50ba43f1e417dd443c0f364d9554ef6e495024d492924ddabd89eccbec0f14f7`.

The user authorized deployment of both website fixes and explicitly required the desktop installer to remain unpublished. The candidate was built from the immutable Git archive, checked before promotion, and promoted only after all ten candidate GET checks passed. All ten live GET checks also passed, and production inspection confirms the expected deployment. The deployment metadata names the exact runtime commit above.

## Included fixes

- Accept valid native archived Atlas BO3 Games 1–2 without inventing terminal board fields. Bind each archived/later BO3 attachment to its original private room using bounded immutable raw-capture verification and exact canonical reproduction. Ownership, replay access, account/generation fences, private notes and unknown cards remain protected.
- Prevent demonstrated false game splits caused by an unnumbered same-room setup echo after gameplay. Preserve explicit numbering, genuine room changes and postgame transitions. For already-stored affected replays, clear stale setup overlays only after confirmed authoritative sequence/history continuity proves gameplay continued.

Details: [BO3 native exports](./ATLAS-BO3-NATIVE-EXPORTS-2026-10-26.md) and [battlefield overlay](./REPLAY-BATTLEFIELD-OVERLAY-2026-10-27.md).

## Completed local validation

1,994 tests passed; nine existing Firestore emulator-only tests were skipped. Current-source TypeScript, scoped lint, independent reviews and the local production build passed. The supplied public overlay replay passed all 2,409 events through forward and reverse checkpoint seeking; browser checks preserve genuine setup and uncover all three continuing gameplay segments. The earlier Riven three-game canonical remains byte-identical and its three native attachment saves pass offline with mocked persistence.

No production artifact repair, replay reprocessing, backfill or profile mutation is included. Existing extra game labels and lost battlefield metadata in the reported replay are not rewritten. Successful live attachment of the newer BO3 remains unverified; automatic desktop collection only retries eligible Ready captures within six hours. The matching desktop query correction is in the unpublished local installer, not the public desktop release.

The clean deployment archive excludes local preview scripts, output, credentials and the pre-existing dirty next-env bytes. Preserve rollback deployment `dpl_6moLoY6bkFyLLc2coEXHF7eyfQgf`, runtime `8fa1f985d361c6956b9e704eab2c820269564fb9`.

## Publication checks

The reported public replay still returns exactly the original 2,409-event canonical artifact. Existing public shared All cards metadata and full export reads return one available shared game, with no private notes and no management access. Anonymous review-list and replay-review reads return 401; malformed replay IDs return the expected 400. No authenticated attachment PUT, note change, backfill or replay reprocessing was performed.

Fresh isolated production-browser verification passed at 15:14 UK. The stale Selected battlefields overlay is absent at 116.65, 1,000 and 2,300 seconds; genuine setup overlays remain at 50, 885 and 2,098 seconds. Board and controls remain visible at all six positions. Rewind/forward controls and reloading the reported point passed with no JavaScript page errors. Anonymous private-review 401 responses and an existing favicon 404 were the only observed console issues. The owned browser was closed; no account or real user profile was used. See `live-browser-verification.json` and screenshots under `output/playwright/bo3-overlay-release-20261027/`.

Evidence: `output/release-bo3-overlay-20261027/`, including `runtime-source.json`, `candidate-meta.json`, `candidate-verification.json`, `live-verification.json`, `production-after.json`, and the deployment/promotion logs. All desktop source files, refs/index, the two local installers and the public v0.9.88 installer were verified unchanged. Original website next-env bytes and local preview scripts are preserved. A documentation-only desktop START_HERE update records this release.
