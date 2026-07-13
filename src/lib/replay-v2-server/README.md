# Replay v2 server contract

Replay v2 uses an authenticated, idempotent three-step upload:

1. `POST /api/v2/replays/init` declares `captureId`, compressed byte size, SHA-256, visibility, and optionally the
   ISO `capturedAt` time. `createdAt` remains the server-side upload audit time; replay libraries prefer `capturedAt`
   for card dates and ordering, with `createdAt` retained as the fallback for older records.
2. `PUT /api/v2/replays/:replayId/raw` sends gzip bytes with the returned declaration headers.
3. `POST /api/v2/replays/:replayId/complete` normalizes the raw capture and atomically switches the canonical generation.

All management calls require a non-anonymous, linked-account Firebase bearer token. Raw captures and canonical generations are immutable private
artifacts, even when the replay is public. Only the owner diagnostics route can return raw bytes. Public and
unlisted canonical replays are read through `GET /api/v2/replays/:replayId`; private reads require either the bearer
token or a short-lived embed session.

Canonical and replay-list responses are deliberately `no-store`. This ensures a public-to-private visibility change
cannot leave an older replay or listing available through a shared CDN cache.

Desktop embedding first posts its Firebase bearer token to `POST /api/v2/replay-embed-session`. The response sets a
Secure, HttpOnly, SameSite=Lax cookie and never places authentication material in a URL. Production must define
`REPLAY_EMBED_SESSION_SECRET` with at least 32 bytes. The endpoint fails closed when it is absent.

The server upload and canonical response limits are both 4 MiB compressed, with at most 50,000 source messages. This stays below Vercel Functions'
approximately 4.5 MiB request/response body limit. Larger captures will require a future signed multipart Blob
transport; the init and complete contract is intentionally independent of the current binary transport.

Private Vercel Blob is the default artifact store. The Firestore chunk fallback is fail-closed unless
`REPLAY_V2_ALLOW_FIRESTORE_ARTIFACTS=enabled` is configured. Before enabling it, Firestore rules must deny every
client read and write to `replayV2`, `replayV2Owners`, `replayV2Public`, and `replayV2Artifacts`; these collections
are accessed only through the Admin SDK API routes.
