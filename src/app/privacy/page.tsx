import { SectionHeading } from "@/components/site/section-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { createPageMetadata } from "@/lib/seo";

const LAST_UPDATED = "22 May 2026";

const privacySections = [
  {
    title: "What RiftLite is",
    body: [
      "RiftLite is a companion app and website for Riftbound players. It helps players record matches, review games, manage decks, use private hubs, create coaching replays, use Scorepad, and browse community-submitted data.",
      "Most RiftLite features are optional. You can use the desktop app locally without creating an account, and you can choose whether match data stays local, syncs to private hubs, or contributes to community-submitted stats.",
    ],
  },
  {
    title: "Information we collect",
    body: [
      "Account information: if you create or link a RiftLite profile, we may store your Firebase user ID, email address, sign-in provider, public handle, display name, profile settings, and privacy preferences.",
      "Match and deck information: when you save or sync matches, RiftLite may store legends, player names, result, format, scores, seat, platform, battlefields, deck names, deck snapshots, flags, timestamps, and hub/team destinations.",
      "Social Hub information: if you use private hubs, teams, applications, message boards, invites, or Find Match listings, we store the information needed to run those features, including posts, roles, room codes, temporary Discord voice metadata, and moderation actions.",
      "Scorepad information: Scorepad can store matches on your phone first, then sync them to RiftLite Desktop for review. Scorepad/manual matches are treated as personal data by default and do not enter public community stats unless a later feature clearly asks you to opt in.",
      "Replay and coaching information: replays, drawings, voice notes, flags, teaching layers, and coaching packs are primarily stored on your device. If you export or send a replay file, you choose who receives that file.",
      "Technical and analytics information: we may collect page views, app version, basic device/platform information, install or update events, feature usage, timestamps, error diagnostics, and anonymous or account-linked identifiers so we can understand usage, fix bugs, and improve RiftLite.",
    ],
  },
  {
    title: "How we use information",
    body: [
      "We use information to provide RiftLite features, keep your account and profile connected, show your saved stats, power private hubs and teams, process Find Match listings, import Scorepad entries, and keep the community pages working.",
      "We use analytics to understand which pages and features are used, measure daily activity, diagnose crashes or capture problems, and decide what to improve next.",
      "If you provide an email address, we may use it for account access, important service messages, support, safety notices, and product updates. Marketing messages will be handled with the appropriate consent or unsubscribe option.",
    ],
  },
  {
    title: "Public, private, and local data",
    body: [
      "Local data stays on your device unless you sync, export, or share it. This includes local match history, many replay files, coaching packs, deck notebooks, matchup prep guides, and private notes.",
      "Community data is user-submitted. If you choose to sync a match to community stats, parts of that match may appear publicly on RiftLite.com, including legends, result, score, deck name or deck snapshot, battlefields, platform, date, and player names or handles where provided.",
      "Private hub data is visible to members of that hub and to users with the relevant permissions. Deleting a match from a hub does not automatically delete community-submitted data or your local copy.",
      "Team pages may be public or private depending on team settings. Public teams can show profile details, members, social links, and team-submitted data. Team message boards are intended for team members unless clearly marked otherwise.",
      "Find Match listings are temporary and visible to signed-in RiftLite users while active. Room codes and Discord voice links expire or close with the listing.",
    ],
  },
  {
    title: "Who we share information with",
    body: [
      "We do not sell personal data. RiftLite uses service providers to run the app and website, such as Firebase/Google for authentication and database services, Vercel for hosting and deployment, GitHub for release downloads, and Discord when you choose to use Discord voice or community links.",
      "External links to Discord, YouTube, Twitch, X, Instagram, Metafy, Piltover Archive, Riot, or other community resources are controlled by those services. Their own privacy policies apply when you visit or use them.",
      "We may disclose information if required by law, to protect RiftLite or its users, to investigate abuse, or to respond to valid security, moderation, or support issues.",
    ],
  },
  {
    title: "Retention and deletion",
    body: [
      "We keep account and synced feature data for as long as needed to provide RiftLite, maintain community stats, support private hubs or teams, comply with legal obligations, and protect against abuse.",
      "You can keep many features local by not syncing them. You can also delete local data inside the app where controls are provided.",
      "If you want help exporting or deleting account-linked data, contact us. Some public community statistics may remain in aggregated or anonymised form after individual records are removed.",
    ],
  },
  {
    title: "Your choices and rights",
    body: [
      "You can choose whether to create an account, make your profile public, sync matches to community stats, sync to private hubs or teams, share replay files, or keep data local.",
      "Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or receive a copy of personal data associated with you. We will do our best to help with reasonable requests.",
      "If you are in the UK, you also have the right to raise a concern with the Information Commissioner's Office if you are unhappy with how your privacy request is handled.",
    ],
  },
  {
    title: "Security",
    body: [
      "RiftLite uses Firebase Authentication for account sign-in and does not store your Google password. Email/password sign-in is handled through Firebase Auth.",
      "We use reasonable technical and organisational safeguards, including permission checks for account, hub, team, invite, and moderation features. No online service can be guaranteed completely secure, so please only share replay files, room codes, and hub/team invites with people you trust.",
    ],
  },
  {
    title: "Children",
    body: [
      "RiftLite is designed for players who are old enough to use online community tools responsibly. We do not knowingly collect personal data from children under 13. If you believe a child has provided personal data, please contact us so we can review it.",
    ],
  },
  {
    title: "Changes to this policy",
    body: [
      "RiftLite is growing quickly, so this policy may be updated as features change. When we make meaningful changes, we will update this page and may also highlight the change in the app or release notes.",
    ],
  },
];

export const metadata = createPageMetadata({
  title: "Privacy Policy",
  description:
    "How RiftLite handles account data, match history, private hubs, teams, Scorepad, replays, analytics, and community-submitted Riftbound data.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow="Privacy"
        headingLevel={1}
        title="Privacy should feel clear, not hidden in fog."
        description="This page explains what RiftLite collects, what stays local, what can become public, and how you can control your data."
      />

      <Card className="space-y-5 text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Last updated</Badge>
          <span className="text-sm font-semibold text-slate-200">{LAST_UPDATED}</span>
        </div>
        <p className="text-base leading-7 text-slate-300">
          RiftLite is built around player control. The desktop app can be used without a login, and the most sensitive
          features, such as notes, replays, coaching layers, deck notebooks, and local match history, are intended to stay
          on your own device unless you choose to sync, export, or share them.
        </p>
        <p className="text-sm leading-6 text-slate-400">
          For privacy questions, data requests, or safety concerns, contact{" "}
          <a className="text-cyan-200 underline underline-offset-4" href="mailto:BMUCasts@gmail.com">
            BMUCasts@gmail.com
          </a>
          .
        </p>
      </Card>

      <div className="grid gap-5">
        {privacySections.map((section) => (
          <Card className="space-y-4" key={section.title}>
            <CardTitle>{section.title}</CardTitle>
            <div className="space-y-3">
              {section.body.map((paragraph) => (
                <CardDescription className="text-[15px] leading-7 text-slate-300" key={paragraph}>
                  {paragraph}
                </CardDescription>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-cyan-300/20 bg-cyan-300/5">
        <CardTitle>Riot Games</CardTitle>
        <CardDescription className="mt-3 text-[15px] leading-7 text-slate-300">
          RiftLite is an independent companion project. It is not endorsed by Riot Games and does not represent official
          Riot Games matchmaking, ranking, or tournament infrastructure. Riot Games assets and references remain subject
          to Riot&apos;s own policies.
        </CardDescription>
      </Card>
    </div>
  );
}
