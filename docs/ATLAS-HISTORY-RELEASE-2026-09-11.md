# Atlas match decks in Web Replay — 11 September 2026

The user authorised publishing the Atlas history deck addition and rebuilding the Windows installer locally. Desktop publication, Android and the other unfinished website work are outside this release.

## Release scope

Atlas Web Replay gains a **Match decks** button beside the board. It pauses playback and opens the completed match's per-game lists, both players, six deck sections, copy controls and main-deck sideboarding changes. Lists must first be added using **Add to Web Replay** in desktop match history. Missing and private lists have explicit empty states.

The new GET/PUT `/api/v2/replays/[replayId]/decks` enforces replay ownership, including server-proven linked identities. PUT requires a bearer token and a matching ready Atlas replay. GET also accepts the existing desktop embed session. Both responses disable caching; input is bounded to 128 KB. The attachment is excluded from canonical playback and public/shared/hub metadata. Sharing a replay does not share these full deck lists. TCGA, caster and combined replay views do not show the control.

## Isolation

Source starts at `55f81fa87a21c4878be0f653116dc79dc6dcf102`, verified against production deployment `dpl_4AEZ4PvtmN2xePMfGrkew2TiekYh` on 11 September. This retains both September 10 Results Bot releases. The older development worktree HEAD is not the production baseline.

Only the Atlas deck contract, view, authenticated endpoint, service/model additions and their tests were copied from `zelonius-web-20260826`. The player received only the import, button slot and grid row. Its unrelated local Your Move playback changes were not copied; the production player has no restricted Your Move mode. No other local website, artwork, homepage, desktop or Android source is included.

## Validation before deployment

- TypeScript passes with incremental output disabled.
- Replay backend, model, API and Discord suites: 40 files / 317 tests pass.
- Replay components: 21 files / 275 tests pass, including clearing deck data when switching replays.
- Focused lint on new source and tests passes.
- Owner/foreign-owner boundaries, linked identities, match/platform/readiness validation, bounded bodies, public projections, game selection, sideboarding, pause-on-open and dialog keyboard handling are covered.

Vercel candidate build, candidate HTTP checks, promotion and public checks are recorded below when complete. Operator logs stay in ignored `output/atlas-history-release-20260911/`.

An actual signed-in embedded Atlas import followed by an owner attachment is still a user acceptance check. The earlier Irelia demonstration used locally extracted data and fixture endpoints; it was not a production write.
