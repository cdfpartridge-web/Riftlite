# Atlas replay statuses and cards — 8 October 2026

Local source update only. The website has not been deployed, and all pre-existing account/Discord/other work and the exact `next-env.d.ts` bytes are preserved.

The replay board and enlarged card previews now show Atlas's 11 current status presets, numeric buffs and counted labels. Custom labels and red/white counters remain supported. The existing capture/normalization/seek pipeline already retains the underlying fields; no protocol or connection change was needed. Hidden opponent cards do not disclose statuses.

Added 61 audited card prints in sync with the active desktop registry: 50 Radiance, 6 Origins alternate prints, 1 Spiritforged alternate print, 2 Secret Garden and 2 Vendetta alternate prints. The registry contains 1,426 prints, Radiance contains 200, and the historical supplemental artwork catalog contains 37. Riven is included in legend selection and image resolution. All previous registry entries are preserved. Chinese-only previews retain the available names/artwork.

Sources: the current public [Atlas client](https://play.riftatlas.com/), [Piltover Archive](https://piltoverarchive.com/cards) and [Riot card gallery](https://playriftbound.com/en-us/card-gallery/). Metadata and collector identities were checked against downloaded artwork; unnumbered placeholders and unverified alias IDs were excluded.

TypeScript and focused ESLint passed. The full website suite passed 1,527 tests in 176 files (9 tests / 1 file remain skipped). The status tests include normalization, patch removal, checkpoint seeking and hidden-card protection. An earlier BO3 UI timing failure passed in isolation and in the final full suite; transition code was not changed. The actual replay component was reviewed in a synthetic Playwright fixture at 1920×1080 and 1280×720, including hover previews. All 11 statuses appeared, private labels remained absent, and there was no page overflow.

Browser evidence and test log: `output/playwright/atlas-status-20261008/`. The complete audit, preservation hashes, source snapshots and artwork contact sheets are in the sibling desktop worktree's `output/atlas-status-cards-20261008/`; its matching dated document contains the complete card breakdown and exclusions. No live profile/game, deployment, installer, release or version change is part of this request.
