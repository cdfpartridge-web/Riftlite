# Partial Atlas mulligans and replay toolbar — 25 October 2026

Website deployment pending final verification. The user requested a partial opponent mulligan view, a local installer, removal of the Cards up button, unclipped toolbar labels and publication of the website updates.

## Behaviour

All cards can now show the opponent's verified kept cards and replacement draws during the mulligan. Returned cards are explicitly Unknown, with their count. The extra first-turn draw is excluded. The original opening, own mulligan, canonical events, review-note anchors and default Player view remain unchanged. Returning to Player view or losing account/attachment access clears the private summary and inspected-card state.

The completed Atlas export must retain valid bounded mulligan playback metadata, start at its exact game_start frame, match an authoritative captured position and have a captured mulligan for that same game. The summary never infers returned identities or uses later deck order. Missing, malformed, restricted, mismatched or old attachments continue playing normally with an explanation that verified mulligan details are unavailable.

Both desktop collection and the website importer now preserve only redrawCount and draw id/cardId/kind/handCountBeforeDraw, with two participants, at most four returns and five draw records. Unknown/secret fields and hidden-rune arrays are excluded. The two supplied Atlas files preserve this metadata through a codec roundtrip and produce correct partial summaries against synthetic canonical anchors; this does not claim those synthetic openings were captured real games.

The obsolete Cards up button is removed from the toolbar. Playback controls no longer shrink, text buttons have sufficient intrinsic width and padding, and labels stay on one line. Controls can wrap within the footer; coverage messages occupy a separate line. Existing timeline, review, side-panel, sound, fullscreen and take-control features remain available.

## Testing and installer

Local Windows installer: `../recording-sharing-refresh-desktop/output/installer-atlas-partial-mulligan-20261025/RiftLiteBetaInstall.exe`, still version 0.9.86. Size 159,781,667 bytes; SHA256 `364527dd86afcefc126285eec15a315f353cbb777b53a3d9b9063fcf3783bb77`. Passed TypeScript, 82 account checks, 3,069 tests, production compilation, Windows package verification, isolated packaged startup and exact packaged-content comparison. It preserves the prior local collection and lag improvements. No installation, public desktop release or version bump was performed.

Website validation covers the codec, exact first-frame binding, malformed and legacy metadata, zero redraws, first-turn exclusion, wrong games/anchors, full-player presentation, unchanged own/canonical state and access revocation. Isolated Chromium shows two kept cards, two replacements and two unknown returns with all four images loaded. Toolbar bounds checks pass at 1540x1000 and 960x700, with the side panel hidden and in fullscreen. Player view restores the captured hidden hand. Browser fixtures contain synthetic data and no real account services.

Use the new installer for newly collected automatic attachments. Older attachments have already discarded the metadata; they require re-importing the original Atlas JSON through Card views to gain this partial summary, if that file is available. Publishing the website does not reconstruct data that was never retained.

Local browser preview: `http://127.0.0.1:4252/?t=5`, backed by `output/atlas-partial-mulligan-local-20261025/preview.mjs`. Source, test and publication evidence is under `output/partial-mulligan-toolbar-release-20261025/` and `output/atlas-mulligan-audit-20261025/`. The prior live website runtime is `54d4a7148f2115969cf321f225baa07ac3cc38fc`, deployment `dpl_95Gh2Qk7D9PR8YwpzQ4VZmRUJ4j3`; preserve it as rollback. Pre-existing next-env.d.ts bytes, local demo scripts, desktop dirty work, prior installers and real profiles are preserved.
