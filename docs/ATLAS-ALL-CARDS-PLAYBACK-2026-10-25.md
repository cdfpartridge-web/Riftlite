# Atlas All cards playback coverage — 25 October 2026

Publication pending final checks. This follows the live production privacy-matching correction in `ATLAS-ALL-CARDS-PRODUCTION-MATCHING-2026-10-25.md`.

## Report and cause

The real owner attachment succeeded with PUT 200 at 23:22:25 UTC on 24 October, followed by successful GETs. The remaining report is a playback-alignment failure, not a missing attachment: the user's screenshot shows All cards selected at 0:47, with the opponent's hand hidden and “Captured view here · no matching Atlas frame”. At that point the canonical seek lands on a `rewind_confirmation_state` packet immediately after a verified authoritative action. The packet changes no board data, but matching discarded its verified Atlas frame merely because the normalized event kind was unknown.

The same invalidation occurred for heartbeat `pong` packets and diagnostics appended after authoritative patch operations. Official Atlas handler inspection confirms pong only acknowledges heartbeat timing; rewind confirmation updates the confirmation prompt, with actual rewinds arriving separately as authoritative state changes.

## Correction and boundaries

Keep a verified frame through explicit unsupported `rewind_confirmation_state` and `pong` packets, and through an unknown-patch diagnostic only when its source-message ID equals the authoritative operation whose resulting board already matched. Recheck the board at every step. Unrecognized packets, different-source diagnostics, unmatched authoritative actions and actual board mismatches still invalidate alignment until a fresh exact match. No future identities are guessed.

The client recomputes alignment from the already stored attachment. Refreshing or closing and reopening the replay is sufficient after deployment; no new game, desktop restart, installer, upload retry or production replay rewrite is required for this correction. The captured opening still uses the original Player view where Atlas has no corresponding frame. Private attachment access, optional sharing, review notes and the canonical timeline are unchanged.

## Validation

All 82 focused tests pass: 54 core matching/import tests, 26 server/privacy tests and two full-player tests. Scoped ESLint passes. TypeScript and production build status are recorded with the deployment receipt.

Regression fixtures pass through the real provider normalizer and privacy sanitizer. Core tests cover seeking through housekeeping, same-timestamp patch diagnostics, invalidation on unrelated packets and recovery at a new exact anchor. Full React-player tests use the actual decoder, matcher, account hook and renderer; they verify revealed names/images, switching back to hidden Player view, preserved opening and unchanged canonical data.

An isolated Chromium fixture reproduced the failure before the change. Afterward the same seek position displays the opponent's Daring Poro name and a loaded card image (natural width 1,030px), shows the All cards badge and removes the fallback message. Switching back to Player view restores Hidden card with no identity image. The fixture uses synthetic players and data and no real account services. Browser evidence is under `output/all-cards-playback-20261025/`; focused-suite receipts are under `output/atlas-allcards-display-20261025/`.

Deployment, exact runtime source and final validation receipts will be recorded under `output/all-cards-playback-fix-20261025/`. Preserve the previous runtime `74d07be891f16474ce272beceb33b5b681bcb377` / deployment `dpl_EYtb7FxSKim8kKgSNWefSqu3pV9D` as the immediate rollback. No desktop source, public version, installer or real profile changes are part of this website correction.
