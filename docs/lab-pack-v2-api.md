# Targeted training-pack API

The existing no-query endpoints are unchanged:

- `GET /api/app/mulligan-lab` continues to return Mulligan Lab v1/v2.
- `GET /api/app/sideboard-lab` continues to return Sideboard Lab v1.

The additive endpoints below read daily precomputed shards built from the full
anonymous fact corpus. They never query raw replay artifacts on a user request.

## Query validation

`GET /api/app/mulligan-lab/v2`

- `playerLegend`: required registered Legend print code; alternate prints are canonicalized to their base identity.
- `opponentLegend`: optional registered Legend print code.
- `deckFingerprint`: optional lowercase/uppercase SHA-256; normalized to lowercase.
- `initiative`: optional `first` or `second`.
- `limit`: optional integer from 1 through 24; defaults to 12.

`GET /api/app/sideboard-lab/v2`

- The same Legend, fingerprint, and limit rules.
- `priorGameResult`: optional `win` or `loss`.
- `targetGameNumber`: optional `2` or `3`; defaults to `2`. Game 2 and Game 3
  are always stored and selected as separate cohorts.

An invalid selector returns HTTP 400 and `{ "error": "invalid_lab_query" }`.
Ready and unavailable pack responses return HTTP 200 with `Cache-Control:
no-store` and `Access-Control-Allow-Origin: *`.

Selection order is privacy-safe exact deck (only cohorts with at least eight
decisions/hands and four anonymous contributors), oriented matchup (same gate),
then player-Legend. Card statistics retain their own explicit `matchup` or
`player-legend` scope; selecting a deck never relabels matchup evidence as deck
evidence. Initiative and prior-result strata are separately privacy-gated and
precomputed. A selector is strict: the API never filters a broader public shard
at request time or silently returns the wrong context.

## Mulligan ready shape

The card, deck, evidence, source, and drill fields not expanded below are the
existing Mulligan v2 fields in `src/lib/mulligan-lab/contracts.ts`.

```jsonc
{
  "schema": "riftlite-mulligan-lab-pack",
  "version": 1,
  "status": "ready",
  "generatedAt": "2026-08-14T08:00:00.000Z",
  "expiresAt": "2026-08-15T20:00:00.000Z",
  "query": {
    "requested": {
      "playerLegend": "UNL-191",
      "opponentLegend": "VEN-145",
      "deckFingerprint": null,
      "initiative": "first"
    },
    "resolved": {
      "scope": "matchup",
      "deckFingerprint": null,
      "sharedCards": null,
      "totalCards": null
    },
    "fallbackReason": null
  },
  "source": {
    "kind": "precomputed-observed-replays",
    "corpus": "anonymized-canonical-web-replays",
    "minimumHands": 25,
    "minimumPlayers": 10,
    "observedFrom": "2026-06-01",
    "observedThrough": "2026-08-14",
    "includedFacts": 420,
    "coverageTruncated": false,
    "coveragePolicy": "all-available-history",
    "includedPeriods": ["preseason", "current-season"],
    "backfillComplete": true,
    "seasonCoverage": {
      "currentSeasonStartedOn": "2026-07-31",
      "preseasonFacts": 180,
      "currentSeasonFacts": 240
    },
    "cardRegistryGeneratedAt": "2026-08-13T08:58:20.672Z",
    "cardRegistryPrints": 1180
  },
  "drills": [{
    "id": "ml2_<32 lowercase hex>",
    "matchup": { "playerLegend": { "cardCode": "UNL-191", "name": "Master Yi, Wuju Master" }, "opponentLegend": { "cardCode": "VEN-145", "name": "Nasus, Curator of the Sands" } },
    "initiative": "first",
    "hand": ["four existing MulliganLabCard objects"],
    "deck": { "fingerprint": "<64 lowercase hex>", "chosenChampionCode": "OGN-014", "mainDeck": ["existing 40-card-count deck entries"] },
    "evidence": { "all existing Mulligan v2 drill-evidence fields": true },
    "context": {
      "curve": { "classification": "two-drop-present", "twoDropCount": 1, "earlyUnitCount": 1 },
      "battlefields": { "player": null, "opponent": null },
      "duplicateIdentityCount": 0,
      "setup": {
        "chosenChampion": { "cardCode": "OGN-014", "name": "Registered Champion name" },
        "replacementPoolCards": 35
      }
    },
    "decisionEvidence": {
      "scope": "matching-curve",
      "hands": 80,
      "players": 32,
      "redrawCountHistogram": [{ "redraws": 0, "hands": 8 }, { "redraws": 1, "hands": 12 }, { "redraws": 2, "hands": 60 }],
      "mostCommonRedrawCount": 2,
      "twoRedrawRate": 0.75,
      "evidenceStatus": "robust"
    },
    "cardEvidence": [{
      "all existing Mulligan v2 card-evidence fields": true,
      "slices": {
        "matchingCurve": { "offered": 80, "players": 32, "kept": 68, "redrawn": 12, "guidancePlayers": 32, "guidanceKept": 28, "guidanceKeepRate": 0.875, "guidance": "strong_keep", "evidenceStatus": "robust" },
        "matchingInitiative": null,
        "preseason": null,
        "currentSeason": null
      }
    }]
  }]
}
```

Every targeted Mulligan drill has `context`, and every card-evidence object has
`slices`; the four individual slices are nullable. Slice counts below eight
offers or four contributors are withheld as `null`. Battlefield, setup, and
Chosen Champion fields are fail-closed: they are published only when the
captured decision boundary and registered 39+1 deck shape prove them. This is
what allows the desktop to calculate exact one-versus-two replacement odds
without guessing which card began outside the shuffled library. Whole-hand
`decisionEvidence` is likewise published only after its own contributor gate.

## Mulligan unavailable shape

```json
{
  "schema": "riftlite-mulligan-lab-pack",
  "version": 1,
  "status": "unavailable",
  "generatedAt": null,
  "expiresAt": null,
  "query": {
    "requested": { "playerLegend": "UNL-191", "opponentLegend": "VEN-145", "deckFingerprint": null, "initiative": null },
    "resolved": { "scope": "matchup", "deckFingerprint": null, "sharedCards": null, "totalCards": null },
    "fallbackReason": "matchup-not-observed"
  },
  "source": null,
  "drills": [],
  "reason": "matchup_not_observed"
}
```

Unavailable reasons are `snapshot_not_configured`, `snapshot_invalid`,
`snapshot_expired`, `data_unavailable`, and `matchup_not_observed`.

## Sideboard ready shape

The unexpanded card/deck/evidence fields are the existing Sideboard v1 fields.

```jsonc
{
  "schema": "riftlite-sideboard-lab-pack",
  "version": 1,
  "status": "ready",
  "generatedAt": "2026-08-14T08:00:00.000Z",
  "expiresAt": "2026-08-15T20:00:00.000Z",
  "query": {
    "requested": { "playerLegend": "UNL-191", "opponentLegend": "VEN-145", "deckFingerprint": null, "priorGameResult": "loss", "targetGameNumber": 3 },
    "resolved": { "scope": "matchup", "deckFingerprint": null, "sharedCards": null, "totalCards": null },
    "fallbackReason": null
  },
  "source": {
    "all existing all-history Sideboard source fields": true,
    "cardRegistryGeneratedAt": "2026-08-13T08:58:20.672Z",
    "cardRegistryPrints": 1180,
    "formatPolicy": {
      "format": "bo3",
      "observedRulesEpoch": "unknown",
      "currentReference": {
        "mainDeckCards": 40,
        "sideboardMaximum": 10,
        "swaps": "one-for-one",
        "championChangesAllowed": true,
        "fixedSections": ["legend", "runes", "battlefields"]
      },
      "historicalValidation": "structural-only-no-retroactive-rules"
    }
  },
  "drills": [{
    "all existing Sideboard v1 drill fields": true,
    "context": { "nextInitiative": "unknown", "format": "bo3", "provider": "atlas", "targetGameNumber": 3 },
    "decisionEvidence": {
      "decisions": 100,
      "players": 44,
      "noChangeDecisions": 12,
      "noChangePlayers": 9,
      "noChangeRate": 0.12,
      "swapCountHistogram": [{ "copies": 0, "decisions": 12, "players": 9 }, { "copies": 3, "decisions": 50, "players": 30 }],
      "medianCopiesMoved": 3
    },
    "packages": [{
      "cardsIn": [{ "cardCode": "OGN-050", "name": "Registered name", "count": 2 }],
      "cardsOut": [{ "cardCode": "OGN-001", "name": "Blazing Scorcher", "count": 2 }],
      "decisions": 28,
      "players": 16,
      "selectionRate": 0.28,
      "evidenceStatus": "robust"
    }],
    "pairs": [{
      "cardIn": { "cardCode": "OGN-050", "name": "Rune Prison" },
      "cardOut": { "cardCode": "OGN-001", "name": "Blazing Scorcher" },
      "decisions": 28,
      "players": 16,
      "selectionRate": 0.28,
      "evidenceStatus": "robust"
    }],
    "cardEvidence": [{
      "all existing Sideboard v1 card-evidence fields": true,
      "quantity": {
        "histogram": [{ "copies": 0, "decisions": 35, "players": 22 }, { "copies": 2, "decisions": 65, "players": 31 }],
        "selectedMedianCopies": 2,
        "status": "robust"
      },
      "periods": { "preseason": null, "currentSeason": null }
    }]
  }]
}
```

Package and recurring IN-to-OUT pair publication each require at least eight
decisions and four contributors. They are aggregate patterns, never a sampled
player's submitted plan. Game 3 uses the proven post-Game-2 deck as its
pre-window baseline and never pools with Game 2.
Quantity histograms include zero copies; this is the explicit non-selection
denominator. The current-format reference is not asserted as the captured
rules epoch and is not used to reject otherwise structurally valid historical
facts. Proven Game 2 first-player context is backfilled by Sideboard fact v2;
otherwise `nextInitiative` is `unknown`.

## Sideboard unavailable shape

```json
{
  "schema": "riftlite-sideboard-lab-pack",
  "version": 1,
  "status": "unavailable",
  "generatedAt": null,
  "expiresAt": null,
  "query": {
    "requested": { "playerLegend": "UNL-191", "opponentLegend": "VEN-145", "deckFingerprint": null, "priorGameResult": "loss", "targetGameNumber": 2 },
    "resolved": { "scope": "matchup", "deckFingerprint": null, "sharedCards": null, "totalCards": null },
    "fallbackReason": "matchup-not-observed"
  },
  "source": null,
  "drills": [],
  "reason": "matchup_not_observed"
}
```

The Sideboard unavailable reason set matches the Mulligan one.
