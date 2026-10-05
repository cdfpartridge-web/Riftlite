# Past replay visibility — local fix, 5 October 2026

## Status

Local website changes only. No deployment, version change, or production replay mutation was performed. Existing local card-catalog updates and `next-env.d.ts` were preserved.

## Report and cause

The tester could change the default for future Web Replays but could not find visibility controls for past replays in desktop. This was a real capability mismatch: the embedded My replays library loads the desktop account using a signed HttpOnly session, while its visibility control required a Firebase browser user. The control was therefore hidden even when the owner was successfully authenticated. The PATCH endpoint also accepted only bearer tokens.

Before deployment, the workaround is to sign in to the matching account on the website and open `/replays?scope=mine`, then use the existing Visibility dropdown on the replay card. This changes the selected uploaded replay; the desktop default concerns future uploads.

## New flow

- My replays shows a highlighted **Who can watch?** block and **Change visibility** button for each owner replay, including desktop session users.
- The editor explains Public, Unlisted, and Private. Private copy acknowledges explicitly shared recipients rather than implying that existing private-hub grants are removed.
- Selection requires **Save visibility**. Cancel makes no change; saving/error/confirmation states stay visible. The replay URL and future-upload default stay the same.
- Desktop Match/Replays entry points can open `/replays/<id>?embed=1&manage=visibility`. This opens the same editor over the player without adding ordinary playback chrome. The query flag grants no authorization.
- An owner-only metadata GET (`?manage=visibility`) loads the exact replay's current title and visibility without downloading its canonical artifact. Account expiry and non-owner errors explain what to do.
- The dialog fits and scrolls within short/narrow viewports, traps focus, and isolates keyboard events from the replay player's shortcuts.

## Authorization and preservation

Visibility PATCH accepts existing bearer clients, or a valid desktop session with an exact same-origin Origin header. Cross-origin/missing-origin cookie mutations are rejected; an invalid bearer token cannot fall through to cookie authentication. The backend still resolves verified account aliases and checks replay ownership. Management reads never use the development-only public artifact fallback.

The companion `share-discord` change accepts `automatic: true`. Automatic delivery preserves Public/Unlisted, rejects Private before delivery, and checks privacy again immediately before posting. Explicit manual sharing keeps its existing consent behavior. Deploy this website support before releasing desktop code that sends the new automatic marker or opens the visibility editor. Older clients remain compatible but do not gain the new automatic-delivery guard until updated.

One existing edge remains: a visibility PATCH already pending for upload completion has no server revision or compare-and-set token. An independent newer web change cannot supersede that exact queued PATCH reliably without adding revision tracking. The companion desktop fix stops future-default changes from rewriting completed replay history, but this in-flight conflict is not represented as solved.

## Validation

- Focused library, dialog, authentication, route, and service checks: 67 tests passed before the final keyboard refinement.
- Full website suite: 173 files passed, 1 skipped; 1,478 tests passed, 9 skipped. This included the automatic Discord guard tests.
- Final library/dialog/page checks after keyboard isolation: 25 tests passed, including one additional keyboard regression.
- TypeScript `--noEmit --incremental false` and ESLint on all changed source files passed; final modal/page recheck also passed.
- Parent browser QA used actual ReplayLibrary and dialog components with synthetic data and mocked auth/API. Public and Unlisted saves confirmed the selected replay only; at 390 × 600 the dialog scrolls and Save remains reachable. Screenshots are in `output/playwright/visibility-preview/`. No real replay visibility was changed during QA.

## Main files

- `src/components/replay-v2/library/ReplayVisibilityDialog.tsx` and its tests
- `src/components/replay-v2/library/ReplayLibrary.tsx`, CSS, and tests
- `src/pages/replays/[replayId].tsx` and `src/components/replay-v2/replay-page.test.ts`
- `src/app/api/v2/replays/[replayId]/route.ts` and tests
- `src/lib/replay-v2-server/auth.ts`, `service.ts`, and tests
- `src/app/api/v2/replays/[replayId]/share-discord/route.ts` and tests (companion automatic-delivery fix)
