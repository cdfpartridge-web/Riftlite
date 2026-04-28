# RiftLite Project Handover

Everything a new operator needs to take over the RiftLite project. Read top to bottom; nothing here is optional.

> **Security note:** This file does **not** contain real secrets. For each credential it tells you what it is, where it lives, and how to retrieve or rotate it. Pull the actual values from the listed source — never commit them to the repo.

---

## 1. Source code & deployment

| Thing | Location | Notes |
|---|---|---|
| Website repo | `https://github.com/cdfpartridge-web/Riftlite.git` | Branch `main` is what Vercel deploys. |
| Desktop app repo | `https://github.com/cdfpartridge-web/RiftLite-Desktop` | Releases here. The site's download URL pulls from `releases/latest/download/RiftLiteBetaInstall.exe`, so a new release just needs that asset name. |
| Local website checkout | `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite beta build 3\web` | Main checkout. |
| Local desktop checkout | `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06` | Current desktop codebase. |
| GitHub login | Account `cdfpartridge-web` | Owns both repos. |

**To hand off the GitHub side:** add the new owner as a collaborator (Repo → Settings → Collaborators), or transfer ownership outright (Repo → Settings → Transfer ownership). Don't remove your own access until the new owner confirms they can push.

---

## 2. Hosting — Vercel

- **Dashboard:** https://vercel.com → project `riftlite`
- **Production URL:** `https://www.riftlite.com` (apex `riftlite.com` redirects to www)
- **Preview URL:** `https://riftlite.vercel.app`
- **Deploy source:** auto-deploys from GitHub `main` branch. Pushing to `main` triggers a build within seconds.
- **DNS:** the domain `riftlite.com` is registered with whichever registrar holds the apex; A/CNAME records point to Vercel.

**To hand off:** Vercel → Account Settings → Team Members → invite, or transfer the project to a new team. Update DNS at the registrar if the new owner moves it.

---

## 3. Data — Firebase

- **Console:** https://console.firebase.google.com → project `riftlite-b61a5`
- **Plan:** Spark (free tier). 50,000 Firestore reads/day quota — see §11 for cost discipline.
- **Auth:** Firebase Auth, providers used = email/password + anonymous (set up via the Console → Authentication tab).
- **Firestore collections:**
  - `matches` — every public community match. Source of truth for community stats.
  - `aggregates/community-v1` — the rolling cached match window, gzipped, written by the cron. **The website reads this, not the matches collection directly.**
  - `aggregates/weekly-YYYY-Www` — weekly snapshots used to generate news articles.
  - `hubs/{hub_id}` + `hubs/{hub_id}/matches` — private hub data. Counts are surfaced in homepage totals; bodies never leave the server.
  - `users` — minimal profile docs.

**Service-account key** for the Firebase Admin SDK lives in Vercel env (see §9). To rotate: Firebase Console → Project Settings → Service Accounts → Generate new private key → paste JSON into Vercel env. Old key revokes automatically when you replace it.

**To hand off:** Firebase Console → IAM → Add member with new owner's Google account email, role = Owner. Don't remove yourself until they confirm access.

---

## 4. CMS — Sanity

- **Manage dashboard:** https://www.sanity.io/manage → look for project ID matching `NEXT_PUBLIC_SANITY_PROJECT_ID` (in Vercel env)
- **Dataset:** `production`
- **Embedded Studio:** https://www.riftlite.com/studio (route is `/studio/[[...tool]]`, code at `web/src/app/studio/`)
- **Schema types** (defined in `web/src/sanity/schemaTypes/`):
  - `siteSettings` — global stuff (Discord URL, Twitch URL, download URL, guide video ID, etc.)
  - `homeHero` — homepage hero copy (currently uses fixture defaults; Sanity values override when set)
  - `streamModule` — stream block on homepage
  - `adSlotConfig` — ad slot copy
  - `newsPost` — `/news` articles. The weekly meta report cron writes here.
- **API write token** lives in Vercel env as `SANITY_API_TOKEN`. To rotate: Sanity manage → API → Tokens → revoke + create new with **Editor** permission.

**To hand off:** Sanity manage → project → Members → invite new owner's email, role Administrator.

---

## 5. Twitch (live status on stream module)

- **Channel:** `bmucasts` (set in `web/src/lib/fixtures/content.ts` as `FIXTURE_STREAM_MODULE.channelLogin`)
- **API client:** registered at https://dev.twitch.tv/console under your Twitch developer account
- **Credentials:** `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in Vercel env. To rotate: Twitch dev console → your app → New secret.

---

## 6. Google AdSense

- **Slot IDs** are hardcoded in `web/src/lib/fixtures/content.ts` (`FIXTURE_AD_SLOTS`):
  - `5763595628` — home-mid
  - `2957455573` — community-top
  - `2661942105` — news-inline
- The AdSense account itself is linked to your Google account that owns the AdSense property. To hand off, either invite the new owner as a user on AdSense or have them register their own account and replace the slot IDs.

---

## 7. Email / sponsor contact

- `bmucasts@gmail.com` — sponsor enquiries. Linked from the homepage "Become A Sponsor" CTA.

---

## 8. Cron / automation

Both workflows live in `.github/workflows/` and run on GitHub Actions free tier.

| Workflow | Schedule | What it does |
|---|---|---|
| `refresh-aggregates.yml` | Every 4h (`0 */4 * * *`) | Hits `/api/community/aggregate/refresh`, rebuilds the `aggregates/community-v1` doc from the latest matches. Manual trigger available via `workflow_dispatch`. |
| `weekly-meta-report.yml` | Sun 23:30 UTC + Mon 09:00 UTC | Snapshots last week's matches into `aggregates/weekly-YYYY-Www`, then publishes a news article diffing against the prior week. Manual trigger lets you choose `snapshot`, `generate`, or `both`, override the week, or force-overwrite an existing article. |

**Workflow secret:** `COMMUNITY_AGGREGATE_SECRET` — set in Repo → Settings → Secrets and variables → Actions. Same value as the Vercel env var. Both workflows use this single secret.

**Failure alerts:** GitHub Actions emails the repo owner on workflow failure by default. Make sure that email goes somewhere monitored — the cron going red is the first warning that Firestore reads are about to spike (see §11).

---

## 9. Environment variables (Vercel — Production)

Set in Vercel project → Settings → Environment Variables. Local dev mirror lives in `web/.env.local` (gitignored, never commit).

| Variable | Purpose | Secret? | Rotate via |
|---|---|---|---|
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | Sanity project ID | No | n/a |
| `NEXT_PUBLIC_SANITY_DATASET` | `production` | No | n/a |
| `SANITY_API_TOKEN` | Sanity write token | **Yes** | Sanity manage → API → Tokens |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Admin SDK credentials (JSON blob) | **Yes** | Firebase Console → Service Accounts → New key |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Client SDK config | Public-safe | Firebase Console → Project Settings |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Client SDK config | No | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Client SDK config | No | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Client SDK config | No | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Client SDK config | No | Firebase Console |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Client SDK config | No | Firebase Console |
| `COMMUNITY_AGGREGATE_SECRET` | Auth for cron endpoints | **Yes** | Generate a random string; update in **both** Vercel env + GitHub Actions secrets |
| `NEWS_SYNC_SECRET` | Auth for news sync endpoint | **Yes** | Same procedure |
| `TWITCH_CLIENT_ID` | Twitch app ID | Treat as secret | Twitch dev console |
| `TWITCH_CLIENT_SECRET` | Twitch app secret | **Yes** | Twitch dev console |

**To dump current values for a handover:** Vercel project → Settings → Environment Variables → click each row to reveal. Copy into a password manager you share with the new owner — never paste into chat or a doc that gets emailed.

---

## 10. Architecture cheat-sheet

**Stack:**
- Next.js 16 App Router, Tailwind CSS v4 (web)
- Electron + React + TypeScript (desktop)
- Firebase Firestore (data), Firebase Auth (users)
- Sanity (CMS — site copy + news posts)
- Vercel (hosting, edge cache)
- GitHub Actions (cron)

**Read path (the hot path):**
1. User hits any community page or `/api/community/*`
2. Vercel edge cache serves if fresh (`s-maxage=600, stale-while-revalidate=1200`)
3. Edge miss → origin function hits `getCommunityMatchWindow()`
4. `unstable_cache` (TTL 600s) returns cached match window OR
5. Cache miss → reads `aggregates/community-v1` doc (1 Firestore read), decodes gzipped matches, returns
6. Page filters/aggregates the in-memory match window; never re-reads Firestore for the same request

**Write paths:**
- Desktop saves a match → calls `/api/community/aggregate/append` with Firebase ID token → transactional update to aggregate doc → `revalidateTag("community-matches")` busts the unstable_cache
- Cron `/api/community/aggregate/refresh` (every 4h, secret-auth) → reads up to `COMMUNITY_WINDOW_SIZE` matches from Firestore → writes the full aggregate doc

**Key constants** in `web/src/lib/constants.ts`:
- `COMMUNITY_WINDOW_SIZE = 2000` — max matches in the aggregate doc. Gzip compression (~6–8×) keeps the doc under Firestore's 1 MB cap. If matches collection ever exceeds ~5k, the aggregate will need sharding.
- `COMMUNITY_CACHE_TTL_SECONDS = 600` — 10-min TTL on the cached match window (server-side `unstable_cache`).

**Key file map:**
- `web/src/lib/community/data.ts` — aggregate read/write, cache layer, fallback guard
- `web/src/lib/community/aggregate.ts` — leaderboard / matrix / decks / overview computations
- `web/src/lib/community/weekly-snapshot.ts` — weekly snapshot logic + ISO week math
- `web/src/lib/community/meta-report.ts` — meta report article builder
- `web/src/app/api/community/` — all community API routes
- `web/src/app/api/community/aggregate/refresh/route.ts` — cron endpoint
- `web/src/app/api/community/aggregate/append/route.ts` — desktop append webhook
- `web/src/app/api/community/desktop/route.ts` — bulk feed for the desktop client (returns full window with backward-compat field aliases)

---

## 11. Cost discipline (Firestore Spark quota)

Spark tier = 50,000 reads/day. Steady-state usage:

| Source | Reads/day |
|---|---|
| Cron refresh (6 runs × ~600 matches + ~50 hub reads) | ~4,000 |
| Append webhook (1 read + 1 write per match) | ~match volume |
| Public read endpoints (cache absorbs) | ~150 |
| **Total** | **~4–5k/day** |

Plenty of headroom. The two failure modes that can blow the quota:

1. **Cron breaks for >24h** → aggregate doc becomes stale → cache misses fall back to live Firestore scans. **Mitigated:** `FALLBACK_DAILY_CAP = 6` in `data.ts` hard-caps fallback at 6 × `COMMUNITY_WINDOW_SIZE` = 12k reads/day max. After that, fixtures.
2. **Append webhook gets spammed by an attacker** with valid Firebase ID tokens. **Mitigated:** the route enforces that `match.uid === decoded.uid`, so a token only lets you spam *your own* matches. Worst case is 1 user blasting their own match history into the aggregate, which is bounded by the doc-size cap.

The auth-gated paths (`/append`, `/refresh`) cannot be brute-forced — refresh needs the shared secret, append needs a Firebase ID token.

The public-read paths cannot be made expensive — they all share one cached match-window entry, so 1 person or 1M people hitting them = the same ~144 origin reads/day max.

If you ever need to lift the read budget meaningfully, options in order of effort: tighten cron cadence to every 6h (saves ~1.5k/day), shard the aggregate doc, or move to Firebase Blaze pay-as-you-go (~$0.06 per 100k reads).

---

## 12. Common operations

**Trigger the aggregate refresh manually (e.g. after fixing the cron):**
1. https://github.com/cdfpartridge-web/Riftlite/actions/workflows/refresh-aggregates.yml → Run workflow → main → Run.
2. OR: `curl -X POST -H "Authorization: Bearer $SECRET" https://riftlite.vercel.app/api/community/aggregate/refresh`

**Re-publish a weekly meta report:**
1. Actions → Weekly meta report → Run workflow → job=`both`, week=`YYYY-Www`, force=`true` (overwrites existing article).

**Patch a Sanity field for all docs of a type:** scripts in `web/scripts/` show the pattern (e.g. `patch-download-url.mjs`, `patch-guide-video.mjs`). Copy one of those and adjust the field.

**Run the website locally:**
```
cd web
npm install
cp .env.local.example .env.local   # then fill in values from Vercel
npm run dev
```
Studio at http://localhost:3000/studio.

**Run tests:**
```
cd web
npx vitest run --reporter=dot
```

---

## 13. Known follow-ups

- `web/public/screenshots/community.png` is from Apr 21 — should be re-shot once a clean leaderboard tab screenshot is available.
- If the matches collection ever exceeds ~5,000 docs, the aggregate doc will start brushing the 1 MB Firestore cap even with gzip. Plan: shard into `community-v1-shard-N`.
- `weekJustEnded()` in `weekly-snapshot.ts` was patched to handle Monday-morning manual runs; the Sunday-night cron still works correctly.
- The `claude/quirky-lehmann-1e0042` branch is a worktree used for one AI session and can be deleted after merging to `main`.

---

## 14. Emergency runbook

**"The site is down."**
1. Check Vercel dashboard for failed deploy. Roll back via Deployments → previous → Promote.
2. If origin works but pages 500: check Vercel function logs filtered to the failing route.

**"Firestore reads spiking."**
1. Open Firebase Console → Firestore → Usage. See which queries.
2. If `COLLECTION /matches ORDER_BY` is firing > 6×/day: cron is dead OR fallback cap bypassed. Check Actions for cron failures.
3. If unexpected: rotate `COMMUNITY_AGGREGATE_SECRET` (Vercel + Actions in lockstep).

**"Homepage stat freezes at a number."**
1. Cron probably broke. Run `refresh-aggregates` workflow manually.
2. If the workflow goes red, paste the failing curl response — it'll show the actual error from the route.
3. Common cause was the Firestore 1 MB doc cap (fixed via gzip in `data.ts`). If matches collection has grown past ~5k, see §13.

**"Weekly meta report didn't publish."**
1. Check Actions → Weekly meta report. Each step's log shows the curl response.
2. Generate step needs the snapshot to exist. If snapshot failed, re-run with job=`snapshot` first, then `generate`.
3. If article shows wrong dates: see commit history for `weekJustEnded` / `fmtWeekRange` fixes — both have caused real bugs.
