# RiftLite Discord Bot Groundwork

This adds a Discord slash-command bot backed by the RiftLite website. It links a Discord server to a RiftLite private hub, verifies users against their RiftLite account, assigns an optional Discord role, and exposes lightweight testing stats.

## Environment variables

Set these on Vercel and in `.env.local` for local command registration:

```bash
DISCORD_APPLICATION_ID=your_discord_application_id
DISCORD_PUBLIC_KEY=your_discord_interactions_public_key
DISCORD_COMMUNITY_BOT_TOKEN=your_discord_bot_token
RIFTLITE_BOT_API_TOKEN=a_long_random_internal_token
```

Optional for fast guild-only slash command registration:

```bash
DISCORD_GUILD_ID=your_test_discord_server_id
```

## Discord Developer Portal setup

1. Create a Discord application.
2. Copy **Application ID** to `DISCORD_APPLICATION_ID`.
3. Copy **Public Key** to `DISCORD_PUBLIC_KEY`.
4. Create/reset the bot token and save it as `DISCORD_COMMUNITY_BOT_TOKEN`.
5. Set the Interactions Endpoint URL:

```text
https://www.riftlite.com/api/discord/bot/interactions
```

For preview testing, use the Vercel preview URL instead.

## Bot invite URL

Use OAuth2 URL Generator with scopes:

```text
bot
applications.commands
```

Bot permissions needed for V1:

```text
Manage Roles
Send Messages
View Channels
Read Message History
```

Important: the bot's Discord role must sit above the role it is trying to assign.

## Register slash commands

For a test server, set `DISCORD_GUILD_ID` first. Guild commands usually appear quickly.

```bash
npm run discord:register
```

For global commands, remove `DISCORD_GUILD_ID` and run the same command. Global commands can take longer to appear.

## User flow

1. A user joins Discord.
2. They run:

```text
/verify
```

3. Discord gives them a private verification link.
4. They open it, sign in with their RiftLite account, and press **Verify Discord**.
5. RiftLite stores the Discord-to-RiftLite link.
6. If the server is configured with a verified role, RiftLite asks Discord to assign it.

## Admin setup flow

The admin must:

- have Discord **Manage Server** permission
- run `/verify`
- be an owner/admin of the RiftLite private hub

Then run:

```text
/setup hub_id:<hub id> verified_role:<role> feed_channel:<channel> reports_channel:<channel>
```

`verified_role`, `feed_channel`, and `reports_channel` are optional but recommended. The configured `reports_channel` receives opted-in unlisted replay links from verified hub members.

## Slash commands

```text
/verify
```

Creates a short-lived RiftLite verification link.

```text
/verified
```

Privately lists the Discord members who have linked a RiftLite account, including their current RiftLite display name, handle, and verification date. This requires Discord **Manage Server** permission and a verified RiftLite account that owns or administers the connected private hub. Emails and Firebase account IDs are never shown.

```text
/setup hub_id:<hub id> verified_role:<role> feed_channel:<channel> reports_channel:<channel>
```

Links this Discord server to a RiftLite private hub.

```text
/recent count:5
```

Shows recent synced matches from the connected hub.

## Opt-in replay feed

RiftLite desktop users can explicitly select joined private hubs under **Account → Replay and account connection** and enable Discord replay sharing. For each newly completed Atlas replay:

1. the processed replay is set to **Unlisted**—anyone with the permanent link can watch, but it is excluded from public replay listings;
2. the website verifies the replay owner is still a member of every selected hub;
3. the bot posts player names, legend matchup, score, format, and link only to that hub's configured `reports_channel`;
4. deterministic server claims and Discord nonces make retry safe without repeating successful posts.

This is dual consent: the player opts in and selects the hub, while the hub owner/admin chooses the Discord destination through `/setup`. Raw capture data, room codes, chat, account IDs, and private diagnostics are never posted. Disabling upload/sharing, unlinking, switching account, or restoring a backup revokes the local consent. Existing replays are not backfilled automatically.

```text
/leaderboard range_days:7
```

Shows the testing contribution leaderboard.

```text
/weekly-report post:false
```

Shows a weekly testing report. Set `post:true` to post it to the configured reports channel.

```text
/testing-goals list
/testing-goals add text:"Test Vex vs Diana"
/testing-goals complete id:"abc123"
```

Lists, adds, and completes hub testing goals. Add/complete require RiftLite hub owner/admin permission.

## Internal bot API endpoints

These are protected by:

```http
Authorization: Bearer <RIFTLITE_BOT_API_TOKEN>
```

Examples:

```bash
curl -H "Authorization: Bearer $RIFTLITE_BOT_API_TOKEN" \
  "https://www.riftlite.com/api/bot/hubs/HUB_ID/recent?count=5"

curl -H "Authorization: Bearer $RIFTLITE_BOT_API_TOKEN" \
  "https://www.riftlite.com/api/bot/hubs/HUB_ID/leaderboard?days=7"

curl -H "Authorization: Bearer $RIFTLITE_BOT_API_TOKEN" \
  "https://www.riftlite.com/api/bot/hubs/HUB_ID/weekly-report?days=7"
```

These are intended for future scheduled posting, external bot workers, or admin dashboards.

## Read/resource behavior

- No realtime listeners.
- Slash commands read on demand only.
- Leaderboards/reports read the latest hub match slice, capped server-side.
- Verification writes one small link document and optionally assigns one Discord role.
- No emails are exposed to Discord.
