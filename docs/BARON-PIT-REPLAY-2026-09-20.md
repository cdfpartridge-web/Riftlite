# Baron Pit web replay preview — 2026-09-20

Status: the user approved the middle placement and requested live deployment on September 20. Production verification and the final deployment receipt will be recorded below. No production record changes or historical artifact migration are included.

Branch `codex/baron-pit-replay-20260920`, based on current release receipt `306b457`. This isolated checkout preserves the unrelated desktop and website development work.

## Behavior

Baron Nashor adds Baron Pit if absent and enters the newly created battlefield. The Pit permits units to move there from anywhere. Creation is conditional; a second Baron must not create another copy. The replay follows recorded battlefield state, retaining an empty Pit until removal/reset instead of tying visibility to Baron's presence.

Primary card text: https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/59946969e8d21869c3ffe801a3ffbdd8165a873f-744x1039.png?accountingTag=RB

- Existing two-field layout retains its width when no shared field exists.
- Atlas `room.fields.sharedBattlefieldToken` enables a shared middle lane with both players' `battlefieldToken` units, between the local and opponent battlefields (user-requested placement). Merely having Baron in hand/deck does not enable it.
- Crowded three-field rows fan cards within their lane; hover, counters, and the card inspector remain available.
- Forward playback, backward seeks, empty Pit, and new-game reset work. Old Game 2 boundary/setup checkpoints are reconciled so the previous game's Pit does not leak forward.
- Analysis destinations and drag/drop include the Pit only while it exists.
- TCGA normalization preserves `B3` units, `myBF3` battlefield identity, current `myBF1`/`myBF2` selection aliases, and token card codes. Previously normalized TCGA artifacts already discarded these identities as unknown cards; recovering them would require raw-capture re-normalization, which was not performed.

Primary TCGA schema: https://russeus.github.io/RB-TCG-Arena/Riftbound-Game.json

## Real recording and preview

Public Shenobi (Shen) vs JM (Mel), replay `rl2_1e5eff0d8d8deec72ca431573144e452`, captured September 17. A bounded read-only search of 90 public replay canonicals found this recording; no credentials were needed.

Original: https://www.riftlite.com/replays/rl2_1e5eff0d8d8deec72ca431573144e452

Local preview: http://127.0.0.1:4200/?t=770.841

| Moment | Series timestamp | Event |
| --- | --- | --- |
| Before first creation | 12:49.088 | 693 |
| First Pit, Game 1 turn 14 | 12:50.841 | 694 |
| Game 2 boundary (legacy stale metadata) | 13:40.287 | 737 |
| Game 2 Pit creation | 19:59.928 | 1062 |
| Two Barons and two Tentacles in Pit | 27:44.023 | 1477 |

The preview header provides Before Baron, Baron Pit appears, and Watch creation links. Watch creation starts at 12:47; press Play. It uses the actual current `ReplayV2Player` and the unmodified public canonical recording. Local service stubs isolate account services; the server binds to loopback and accepts GET/HEAD only.

From this checkout, start with:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/baron-pit-local/preview.ts
```

Rebuild an already running preview with the same command plus `--build-only`, then reload the browser. It expects the downloaded canonical in workspace root `output/baron-pit-replay-20260920/`.

## Verification

- Final full suite passed: **155 files, 1,232 tests**; one emulator-dependent file / nine tests skipped.
- TypeScript `npx tsc --noEmit --incremental false` and targeted ESLint passed.
- Regression coverage includes display/rewind, both players' Pit units, empty Pit, new-game resets, legacy checkpoint repair, TCGA mapping/privacy, and conditional Analysis moves with undo/redo.
- Browser verification at 1600×1000 confirmed the real two-to-three transition during playback, original two-column widths before creation, Pit artwork, four-unit crowded lane, and Analysis moves out/in.
- Actual replay projection and checkpoint seeking agree at all seven audited moments: 693, 694, 737, 740, 794, 1062, 1477.
- Browser artifacts are in `output/playwright/`; actual-state audit is `output/baron-pit-local/real-replay-verification.json`; final suite receipt is `output/baron-pit-local/tests-final.log`.

The initial broad run exposed two CSS source-reader assertions selecting the conditional selector before the base selector. The conditional rule was placed after the base rule, preserving the computed styles; all four CSS assertions then passed. An initial concurrent player run hit an existing five-second sideboarding test timeout; the isolated player rerun passed all 61 tests. The final full suite uses four workers and a 15-second per-test limit.
