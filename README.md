# RiftLite Web

The `web/` folder contains the new public RiftLite website built with Next.js App Router, TypeScript, Tailwind, and Sanity.

## Quick start

1. Copy `.env.example` to `.env.local`.
2. Fill in Sanity, Firebase Admin, and Twitch values.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `http://localhost:3000`.

## Main features

- Public community leaderboard, legend meta, matchup matrix, matches, and deck pages
- Read-only server-side Firebase data access
- Sanity-backed news and site content
- Twitch status API and embed module
- Sponsor / AdSense-ready ad slot system
- Unit tests, API route tests, and Playwright smoke tests
