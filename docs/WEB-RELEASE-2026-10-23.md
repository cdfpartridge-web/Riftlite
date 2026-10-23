# Official Radiance season — website release

The user authorized publication alongside desktop v0.9.86. Official Radiance becomes the default across stats and replay filters, with a fresh reminder. The fixed user-approved start is `2026-10-23T12:11:27.000Z` (23 October 2026, 13:11:27 UK time). Pre-season and older results remain separately available. See [implementation and coverage](./RADIANCE-SEASON-2026-10-23.md).

Source validation passed 1,772 tests (nine skipped), scoped ESLint and source TypeScript. The deployment uses an exact committed archive with production configuration and no domain promotion until the candidate checks pass. `next-env.d.ts`, local demo scripts and generated output are excluded and preserved. No match data is reset or migrated.

Publication evidence will be recorded under `output/release-radiance-20261023/`, with the deployment receipt appended after candidate and live verification.

## Published and verified

- Runtime: `520c4c49776bee683380d72698337054c59b9362`.
- Live deployment: `dpl_8Qk5bD4m31uZHJXW21gw14e33a3F` at https://www.riftlite.com.
- Exact archive SHA256: `562659deac7d0e23c964453ad8390a4c834a2491cb902ce87c219c429f63dfb6`.
- Previous deployment retained: `dpl_6PQbwc9WzjZFDVGCPurEg1bnc4F1`.
- Candidate and live HTTP checks each passed **54 read-only GETs**, including current/private review behavior and public replay playback assets.
- Live browser checks passed: official default/cutoff reminder, pre-season and explicit All seasons switching, empty cohort controls, replay archives and mobile layout. Zero app console errors; existing AdSense warning and desktop-ad resize behavior recorded in the browser receipt.
- Production build/TypeScript passed from the committed archive. No account writes, match migration or history reset.
- Desktop **v0.9.86** is also public and Latest for Windows and both Mac architectures.

Detailed evidence: `output/release-radiance-20261023/publication.json`, `runtime-source.json`, `candidate-verification.json`, `live-verification.json`, `live-browser-verification.json` and `production-after.json`. Preserved next-env.d.ts, demo scripts and previous deployment were checked before receipt edits. Later documentation commits do not change the immutable deployed runtime.
