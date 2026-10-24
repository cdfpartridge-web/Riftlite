# Web replay arrow orientation — 23 October 2026

**Published 24 October:** Included with the explicitly authorized All cards website deployment, runtime `197d0e43dcf5d1e428dbf034a0cf8947cff08c31`, deployment `dpl_5u36hqwVXeNT77d77cspwEXKQ7JB`. See [the release receipt](./WEB-RELEASE-2026-10-24-ALL-CARDS.md). The local-only statements below describe the original implementation stage.

The user reported that targeting arrowheads always point down. Both the recorded Atlas arrows and the existing chain/analysis arrow layer ended their cubic paths with a control point directly above the endpoint. SVG automatic marker orientation therefore followed a downward final tangent, regardless of the source card's position.

Both layers now use `replayTargetArrowPath`. Its last control point sits behind the endpoint along the source-to-target direction, so automatic rotation points into the target. The earlier part retains a gentle, bounded curve that rotates with the arrow. Existing source/target anchors, card-edge inset, player colors and visibility rules are preserved.

Validation: **109 focused replay and analysis tests passed**, including nine rendered arrow cases covering all eight directions and a short diagonal. Scoped ESLint and source TypeScript passed. The sandbox initially prevented Vitest from renaming its temporary cache; the same focused tests passed outside the sandbox. TypeScript used the existing validation config excluding archived output and local demo scripts, without changing product configuration.

Browser evidence uses the actual player with synthetic local data under `output/playwright/arrow-orientation-20261023/`. No account or production data is needed. This is a local source fix; no desktop rebuild, version bump, commit, push or deployment was performed. The public website remains on the earlier Radiance deployment.

Five browser cases passed at 1920px and 1280px: ten recorded arrows across both player viewpoints, vertical up/down and all diagonal directions, including chain-to-board targets. Each rendered final tangent aligned with its source-to-target direction; screenshots confirmed correct automatic marker rotation. No page errors or external requests. The separate analysis UI rejected the synthetic target selection, so its browser interaction is not claimed; its shared geometry call site and existing analysis tests were checked.
