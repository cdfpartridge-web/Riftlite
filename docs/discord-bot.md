# RiftLite Results Bot

Updated 10 September 2026. Application ID: `1524708623790510241` (previously RB Uk Testing). This is the private-hub results bot, separate from RiftLite's LFG applications.

## What server owners install

Public invite: https://discord.com/oauth2/authorize?client_id=1524708623790510241

The Discord-provided link uses Guild Install only, with `bot` and `applications.commands` and permissions `3072` (View Channels and Send Messages). It does not request Administrator or message-reading gateway intents. Server owners authorise the install in Discord; they do not need a bot token, developer account or their own hosting.

Automatic verified roles are optional. Only servers using that feature need to grant the bot Manage Roles and place its highest role above a normal, non-moderation verification role. This role does not itself grant RiftLite hub access.

## Setup and use

The plain-text, two-message Discord guide is [riftlite-results-bot-user-guide.txt](./riftlite-results-bot-user-guide.txt).

1. Create or own an account-managed private hub in RiftLite Desktop → Private Hubs. Claim an older password-only hub through Hub tools first. The website `/hubs` lists memberships and IDs; it does not create hubs.
2. Run `/verify` inside the Discord server, open the private link and sign in with the same recoverable RiftLite account used in the app. Finish the player profile if prompted. Links expire after 15 minutes and must not be shared.
3. Copy the hub ID from Private Hubs → Copy ID, or find it at https://www.riftlite.com/hubs.
4. A Discord member with Manage Server and owner/co-owner permission in that hub runs `/setup hub_id:YOUR_HUB_ID reports_channel:#testing-results`.
5. Invite players to the hub. They join, verify in this server and sync their chosen matches to the hub from RiftLite Desktop.

A private hub connects to one Discord server. Another server needs a separate hub. Administrators can use `/disconnect` to remove the connection without deleting results, account links or goal history, then configure a new connection. A server with an ambiguous legacy mapping fails closed until its administrators resolve it.

## Commands

- `/help`: private setup and command guidance; verification is not required.
- `/verify`: create a private, short-lived account-linking URL.
- `/status`: privately inspect this server's connection; configured details require Manage Server and verified current hub administration access.
- `/setup hub_id:<id> reports_channel:<channel> verified_role:<role>`: configure the connection. Channel and role are optional; existing optional settings are retained when omitted for the same hub. A different hub starts with new destinations. Channels must belong to this server, support messages and be accessible to the bot.
- `/disconnect`: remove this server's binding without deleting hub results.
- `/verified`: privately list verified display names and handles for this server. Requires Manage Server and verified current hub administration access. Emails and internal RiftLite account IDs are excluded.
- `/recent count:5`: private recent results from this server's connected hub.
- `/leaderboard range_days:7`: private testing contribution counts; not a skill rating.
- `/weekly-report`: private weekly summary. `/weekly-report post:true` requires Discord Manage Server plus verified current hub administration and posts to the configured reports channel.
- `/testing-goals list`, `/testing-goals add text:"Test Vex vs Diana"`, `/testing-goals complete id:<displayed-id>`: private hub goals. Writes require the hub's manage-goals capability. Goal history stays associated with its original hub when a server reconnects elsewhere.

Results and goals require a verified Discord-to-RiftLite link for this server and current membership of its connected hub. Normal replies are ephemeral (visible to the requester). The connected hub's configuring administrator must still be authorised; otherwise a current administrator needs to run setup again. No automatic weekly posting or general match-feed scheduler exists. The old reserved `feed_channel` option is omitted from new registrations.

## Privacy and delivery boundaries

Discord's verified interaction signature supplies the server ID; callers cannot choose a foreign hub for a results command. Commands are restricted to server installations and server contexts. Signature freshness and application identity are checked, and database work is deferred after a prompt private acknowledgement to avoid Discord's three-second response deadline.

Setup enforces one hub/one server in a Firestore transaction. Result queries and delivery reject duplicate or stale mappings. Every external report/replay post checks the current binding, current configuring-admin access, and the selected channel's actual Discord server. Optional verification roles are checked for hierarchy, ownership and dangerous permissions.

Administrators choose who can read the reports channel. Posted reports are visible to those channel readers, including readers who are not hub members. Ordinary private command replies cannot prevent a recipient manually copying information.

Replay sharing is a separate user opt-in. In RiftLite Desktop → Review → Web Replays, enable the appropriate capture/upload controls and select hub destinations under Discord sharing. Future completed recordings can post their display names, legend matchup, score, format and replay/deck links. Historical replays are not automatically backfilled.

A replay becomes Unlisted only when an eligible delivery reaches its visibility preparation step. No eligible destination means no visibility change. Unlisted links are bearer links: anyone with the URL can watch, including people outside the server if it is forwarded. Disconnecting or disabling future sharing does not retract existing Discord posts or revoke existing replay links. Raw captures, room codes, chat, email addresses and internal account IDs are not posted.

Delivery claims and deterministic Discord nonces reduce duplicate posts on retries. External Discord delivery and Firestore receipts are not a single atomic transaction; exactly-once delivery after an indeterminate network failure is not guaranteed. Setup changes and permission revocation stop subsequent eligibility checks; an already-sent message cannot be unsent by disconnecting.

Privacy policy: https://www.riftlite.com/privacy. The bot-specific section describes account linking, stored configuration, result delivery and Unlisted replay sharing. App Directory discovery/monetization is a separate release step; no Terms of Service URL or directory listing is created here.

## Operator configuration

Results-bot environment variables:

```text
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
DISCORD_COMMUNITY_BOT_TOKEN
DISCORD_CLIENT_SECRET
RIFTLITE_BOT_API_TOKEN
```

Never substitute `DISCORD_BOT_TOKEN` or `DISCORD_CLIENT_ID`: these can belong to the separate LFG bot. Keep all credentials on the operator's server. New server owners must never receive them.

Interaction endpoint: `https://www.riftlite.com/api/discord/bot/interactions`

Existing account-recovery OAuth callback: `https://www.riftlite.com/api/auth/discord/callback`. Do not reset tokens or change OAuth scopes/callbacks for an ordinary bot install.

### Command registration

Dry-run review is the default, and target selection must be explicit:

```powershell
npm run discord:register -- --global
npm run discord:register -- --guild=YOUR_SERVER_ID
```

After the candidate backend is deployed and validated, add `--apply` to register that scope. The script first checks the bot token belongs to `DISCORD_APPLICATION_ID`. Global commands are necessary for other servers; guild-only commands are a test-server override and do not make the app work everywhere. The script never removes a guild's existing commands automatically.

Internal `/api/bot/hubs/<hubId>/...` endpoints remain operator-only APIs guarded by `RIFTLITE_BOT_API_TOKEN`. That credential spans hubs and must not be distributed to server owners or used as a public per-server API. Public Discord users go through signed interactions and current membership checks.

## Verification and deployment record

See `docs/RESULTS-BOT-RELEASE-2026-09-10.md` for final test counts, exact deployed source, public command registration and acceptance limits. Read-only live audit output is in ignored `output/discord-results-readiness-20260910/`; it contains configuration checks, not match/replay bodies. Credential captures in that directory remain local and must never be uploaded or committed.

The release is prepared from the current production baseline `135d2398f33f77888adb3716b87ba81d16966b8d` in an isolated worktree. Local Your Move, artwork, release-label and desktop changes are excluded. Existing hub results and local demos are preserved. The user explicitly left live installation/isolation testing in a second server pending; automated independent-server tests do not replace that acceptance check.

Official Discord references: [installation](https://docs.discord.com/developers/resources/application), [application commands](https://docs.discord.com/developers/interactions/application-commands), [interaction verification and timing](https://docs.discord.com/developers/interactions/receiving-and-responding), [permissions](https://docs.discord.com/developers/topics/permissions).