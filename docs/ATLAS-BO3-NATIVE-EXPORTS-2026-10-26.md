# BO3 native exports and per-game attachment identity — local, 26 October 2026

**Website published 27 October 2026:** [release receipt](./WEB-RELEASE-2026-10-27-BO3-OVERLAY.md). The dated local-only status below is historical. The desktop candidate remains unpublished; no new live BO3 attachment is claimed.

The new Riven mirror BO3 exposed two independent failures. Atlas's native Games 1–2 exports have valid completed envelopes but no `gameOutcome` or `gameHistoryEndedAt` in any frame. Separately, later games use different rooms from the replay's private first-room metadata. The old terminal checks rejected Games 1–2; the old scalar room check rejected later-game attachment.

## Local correction

- `src/lib/replay-v2/atlas-postgame/validation.ts` accepts only the observed archived BO3 G1/G2 shape: consistent series/game identity, every frame strictly lacking both terminal fields, ordered bounded frames and a valid nonfuture completed envelope. It does not synthesize an outcome or timestamp. Explicit endings, BO1 and Game 3 retain terminal checks.
- `src/lib/replay-v2-server/atlas-postgame.ts` binds every archived BO3 import and every later BO3 game to the aligned game's original private room. It reads the already-owned immutable raw artifact with compressed/decompressed bounds and original size/checksum verification, normalizes it, and requires its privacy projection to reproduce the stored canonical except publication diagnostics. The write transaction rechecks artifact pointers, capture identity and raw declaration.
- The first-room fast path cannot bypass this binding for archived Game 1 or later BO3 games. An inferred game boundary does not require the normalizer's initial `explicitGameNumber` flag when the aligned original game identity is otherwise proven.
- Original replay access, private notes, canonical data and hidden/unknown card behavior remain unchanged. Only the attachment supplement is written.

The desktop companion corrects its own native archive validation and retains the local lag-test changes. Its verified local installer is `../recording-sharing-refresh-desktop/output/installer-atlas-bo3-native-20261026-214904/RiftLiteBetaInstall.exe`, still v0.9.88. A desktop installer alone cannot update this server behavior.

## Validation

- 133 focused tests; **1,967 full-suite tests in 201 files passed**, with 9 existing Firestore emulator-only tests skipped.
- TypeScript, zero-warning scoped ESLint, diff checks and the local Next production build passed. Exact original `next-env.d.ts` and `tsconfig.json` bytes were restored after the build; all four changed source/test hashes remained unchanged.
- Actual native exports, processed offline with the real normalizer/privacy projection/decoder/matcher/save service and mocked persistence, save all three games: G1 240 frames / 163 matched events; G2 220 / 121; G3 256 / 408. Private anonymous access remains denied and the original canonical remains unchanged.
- Independent testing of the emitted desktop query's sanitized envelopes yields the same alignments and known opponent-hand projections at every matched position. Original hidden flags/slot IDs and unavailable opening positions remain unchanged.
- Independent review covered malformed/partial endings, wrong game/room, scalar-room spoofing, ownership, bounded artifacts, changed canonical/raw generations and transaction races.

Evidence: `output/bo3-postgame-source-audit-20261026/final-validation-receipt.json`, `native-save-findings.json`, `native-pipeline-findings.json`, `local-build-receipt.json`. The initial `receipt.json` in that folder is the historical pre-fix reproduction.

## Publication and limits

**Local only. No deployment or push is authorized or performed.** Website HEAD remains `99ef815127ab22c75613f8af83cc82c510c7771b`; the live runtime remains `8fa1f985d361c6956b9e704eab2c820269564fb9`, deployment `dpl_6moLoY6bkFyLLc2coEXHF7eyfQgf`. Desktop public v0.9.88 is also unchanged.

The actual production-stored canonical was not fetched or compared, and successful live attachment was not observed. The original raw/canonical reproduction check fails closed for incompatible historical captures. All cards requires exact matching positions; missing opening data stays unknown. Automatic desktop collection still applies only to eligible Ready replays within six hours with the signed-in Atlas guest loaded. Older-game recovery is not promised.
