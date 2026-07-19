# RiftLite Replay V2 Reference Contract

Status: implementation baseline

Reference frozen: 2026-07-09
Primary public reference: `https://riftreplay.com/rl/rp_cd9d5f0ab9`

This document freezes the observed RiftReplay interaction model that RiftLite Replay V2 is reproducing independently with RiftLite branding, code, storage, and assets. Reference defects are recorded explicitly instead of being copied accidentally.

## Product boundary

The first parity milestone includes:

- Atlas raw capture ingestion and immutable diagnostic storage
- server-side normalization into deterministic games, actions, and checkpoints
- replay upload, processing state, library, visibility, sharing, and public viewing
- the complete web player at `/replays/:replayId`
- the same route embedded in RiftLite desktop without website navigation

Broader account and API-key administration is outside this milestone unless it is required by those flows.

The first release may require an internet connection. Offline caching is a later layer and must not require a replay-format change.

## Acceptance viewport and scaling

- Primary comparison viewport: 1920 x 1080
- Minimum supported desktop viewport: 1280 x 720
- Scene aspect ratio: fixed 16:9
- Smaller desktop windows scale the complete scene uniformly; zones must not reflow into a different board
- Mobile playback is not required initially, but controls and data contracts must not prevent a later mobile shell

## Scene layout

The replay is one continuous stage rather than a collection of dashboard panels.

- The stage occupies the left approximately 80% of the viewport.
- A persistent right rail occupies the remaining width.
- The top half is the opponent perspective and is rotated toward that player where appropriate.
- The bottom half is the capture-player perspective.
- Each side exposes a base lane, two battlefield lanes, deck, runes, discard/trash, score, legend, champion, and hand state.
- The shared centre contains the selected battlefields and chain/action lane.
- Cards use stable absolute/transform-based positions so moves can animate between zones.
- The right rail contains the current inspected card above a time-synchronised chat/log feed.
- Transport controls float along the bottom of the stage without moving the board.

## Opening and game-transition sequence

Every game has its own opening sequence. A BO3 is presented as one replay containing separately addressable games.

1. Matchup
   - player names
   - legend and champion pairs
   - versus treatment
2. Selected battlefields
   - two large landscape cards
   - owner-side colour treatment
3. Initiative
   - both roll results
   - clear first-player result
4. Opening hands
   - the capture player's known hand is face-up
   - hidden opponent cards remain card backs
5. Mulligan
   - replaced and retained cards animate separately where the raw evidence permits it
6. Game start
   - hands, decks, runes, legends, champions, battlefields, scores, and turn indicator move into board positions

Between games, show a short `Game 2` or `Game 3` transition, retain sideboarding as a first-class phase when evidence is present, and then repeat battlefield, initiative, mulligan, and opening-hand scenes for that game.

## Transport behaviour

- Initial state: paused on the matchup scene
- Play/pause: Space
- Seek backward/forward: fixed 15 seconds
- Previous/next action: Left/Right Arrow
- Previous/next game: Shift+Left/Shift+Right
- Previous/next turn: Alt+Left/Alt+Right
- Playback speeds: 1x, 2x, and 4x
- More/Less control: toggles frame progress, game navigation, turn navigation, speed, and shortcut help
- Backward seek: reconstruct immediately from the nearest checkpoint without reverse animations
- Forward seek during an animation: finish the current animation, then reconstruct the target state
- Pausing during an animation: freeze the scene without losing its deterministic target state
- A screenshot/share action captures the replay scene without exposing private raw data

Observed reference defect: the public reference begins advancing opening items while its transport still reads `Play`. RiftLite intentionally does not reproduce this; the reveal animation may complete, but the timeline remains at the matchup until playback starts.

## Animation contract

Animations are driven by canonical semantic actions, never by comparing arbitrary whole-board snapshots.

Required action families include:

- draw and mulligan replacement
- play/create/remove/duplicate card
- move between hand, deck, base, battlefield, trash, banished, champion, and rune zones
- reveal a previously hidden card
- exhaust/ready and field/counter changes
- rune and payment batches
- chain add, resolve, and remove
- target arrows and card pings
- score and battlefield conquest
- turn, phase, game, and series transitions
- deck peek/reveal/clear
- chat and system-log insertion
- rewind/correction

Animations should use consistent durations and easing rather than copying incidental reference timing. A normal action should read as one continuous movement: source emphasis, travel/transition, destination settle, then dependent counters or labels.

## Replay truth model

The immutable raw capture is server-private diagnostic input. Public and embedded players receive only a normalized canonical replay.

```text
Raw series capture
  -> ordered and de-duplicated Atlas packets
  -> explicit game and phase segmentation
  -> confirmed semantic actions plus authoritative patches
  -> deterministic state projector
  -> periodic and phase-boundary checkpoints
  -> web playback stream
```

Action intent supplies animation meaning. Authoritative patch commits and snapshots supply state truth. Intents and commits sharing a client action ID produce one confirmed canonical action, not two playback events.

Unknown packets and unsupported patch operations are retained with source references and diagnostics. They must not abort normalization or be silently treated as understood.

## Dual-perspective test workflow

The manual Replay Combiner at `/replays/combine` accepts two accessible Replay V2 links from opposite players in the same Atlas match and creates a third, separate replay.

- The creator must be signed in and explicitly attest that both players agreed to reveal their captured private information.
- A creator-owned Private source is accepted. A source owned by someone else must be Unlisted or Public under the normal replay access rules.
- The server reads only the processed canonical artifacts. It never opens another account's raw capture.
- Pairing requires the same two Atlas player IDs, opposite `perspectivePlayerId` values, compatible BO1/BO3 structure, and shared match evidence. Room-based pairing also requires a compatible capture window and an authoritative event fingerprint.
- Authoritative action pairing uses game ordinal, patch sequence/client action identity, and action type. Optional actor identity and perspective-redacted patch shape are enrichment data, not fingerprint requirements.
- One deterministic authoritative timeline is retained. Matching sequence-keyed snapshots and commits enrich hidden cards and choice fields; secondary commits are never appended or applied twice.
- Owner-only operations and known hidden cards may enrich the retained timeline, including across an unpaired masked snapshot, while conflicting values supplied by both perspectives still stop the merge.
- Public-state disagreement stops the merge. Missing or unpaired evidence is reported in diagnostics rather than guessed.
- The output is immutable, retry-safe, Unlisted by default, and owned by the signed-in creator. Anyone with its link can view it, it is excluded from public listings, and it can later use the existing visibility controls.
- The player shows a **Hidden** badge only while a card is physically at a battlefield with Atlas `hidden: true` and without `revealedToOpponent: true`. Ordinary open-hand/deck secrecy is not labeled.
- Combination generation 2 makes upgraded pairs Unlisted by default without rewriting their generation-1 links.
- The combined player marks the artifact as `Combined replay · Open hands`, reveals both known hands/openings/mulligans and both captured sideboard submissions, but keeps unresolved placeholders and deck order hidden.

For the first real validation pair, both players should begin capture before matchmaking, finish the same short BO1, wait for both uploads to become Ready, make the non-creator's source Unlisted, and paste both permanent links into the combiner. Automation and stronger account-to-account consent grants are a later layer and must not change the immutable source replays.

## BO3 identity

One `SeriesCapture` owns one or more explicit game segments. A new `matchId`, game instance ID, or room code does not end the series when explicit series continuity exists.

Each game records:

- ordinal and reported game number
- all Atlas game-instance IDs and room codes observed for that game
- phase ranges
- first and last source sequence
- result-event identity and final score when known
- initial state, canonical event range, and checkpoints

The current historical corpus contains useful Game 2 and Game 3 segments but no single uninterrupted three-game raw capture. Synthetic fixtures therefore cover series stitching until the continuous capture implementation produces a real complete BO3.

## Security and visibility

- Raw files may contain auth tokens, room codes, player names, decklists, chat, and hidden match state.
- Raw blobs are immutable and private regardless of replay visibility.
- Canonical blobs are immutable and private at the storage layer; the API enforces `private`, `unlisted`, or `public` viewing.
- Uploads are idempotent by owner and capture ID and require compressed size and SHA-256 verification.
- The active canonical generation is switched only after normalization and storage complete.
- Private desktop embedding uses a short-lived HttpOnly website session. Tokens never appear in URLs, page JavaScript, local storage, or renderer IPC.

## Acceptance method

Parity is approved by the product owner using:

- reference and RiftLite screenshots at 1920 x 1080
- named scene/state comparisons
- action-by-action animation recordings
- deterministic seek hashes
- fixture assertions for game, phase, action, and visibility boundaries
- browser and embedded-desktop playback of the same canonical replay

Improvements beyond this contract begin only after the parity milestone is accepted.
