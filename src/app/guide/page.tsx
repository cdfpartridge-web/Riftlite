import Link from "next/link";

import { DiscordCta } from "@/components/site/discord-cta";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE_PATHS } from "@/lib/constants";
import { getSiteSettings } from "@/lib/sanity/content";
import { safeHref } from "@/lib/utils";

export const metadata = {
  title: "How to Use RiftLite",
  description:
    "Video walkthrough and quick steps for installing RiftLite, tracking your first match, and sharing stats with the community.",
};

export const revalidate = 600;

// Accepts a raw ID ("dQw4w9WgXcQ") or a full YouTube URL and returns the 11-char video ID.
function parseYouTubeId(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const bareIdPattern = /^[A-Za-z0-9_-]{11}$/;
  if (bareIdPattern.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.replace(/^\//, "");
      return bareIdPattern.test(id) ? id : null;
    }
    if (url.hostname.endsWith("youtube.com") || url.hostname.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && bareIdPattern.test(v)) return v;
      const embedMatch = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];
      const shortsMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

const steps = [
  {
    title: "Install in under a minute",
    body: "Download the installer, run it, and RiftLite sits quietly in the background — no account required, no configuration forms.",
  },
  {
    title: "Every match tracked automatically",
    body: "Play Riftbound on TCGA or RiftAtlas and RiftLite captures the legends, deck, points, and result for you — no buttons to press, no end-of-session cleanup.",
  },
  {
    title: "Read your stats — or share them",
    body: "Browse your own win rates, study matchups, or contribute anonymous games to the community stats on this site.",
  },
];

export default async function GuidePage() {
  const settings = await getSiteSettings();
  const videoId = parseYouTubeId(settings.guideVideoId);

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
      <SectionHeading
        eyebrow="Getting Started"
        title="How to use RiftLite."
        description="Watch the walkthrough, follow the steps, and start tracking your games in a couple of minutes."
      />

      {videoId ? (
        <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-black shadow-[0_0_60px_rgba(89,167,255,0.08)]">
          <div className="relative aspect-video w-full">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`}
              title="RiftLite — How to Use"
            />
          </div>
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500">
            Video coming soon
          </div>
          <h3 className="font-display text-xl font-semibold text-white">
            Walkthrough landing shortly
          </h3>
          <p className="max-w-md text-sm leading-6 text-slate-400">
            The full video guide is being recorded. In the meantime, the steps below cover
            everything you need to get going.
          </p>
        </Card>
      )}

      <div className="space-y-6">
        <h2 className="font-display text-2xl font-bold text-white">The short version</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <Card className="space-y-3" key={step.title}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/15 font-display text-sm font-bold text-cyan-200">
                {index + 1}
              </div>
              <h3 className="font-display text-lg font-semibold text-white">{step.title}</h3>
              <p className="text-sm leading-6 text-slate-400">{step.body}</p>
            </Card>
          ))}
        </div>
      </div>

      <Card className="flex flex-col gap-5 bg-[linear-gradient(135deg,rgba(89,167,255,0.12),rgba(166,124,255,0.12))] md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          <h3 className="font-display text-xl font-semibold text-white">
            Ready to track your first match?
          </h3>
          <p className="text-sm leading-6 text-slate-400">
            Grab the installer and you&apos;ll be logging matches before your next game ends.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={safeHref(settings.downloadUrl)}>Download RiftLite</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href={SITE_PATHS.meta}>See the stats</Link>
          </Button>
        </div>
      </Card>

      <DiscordCta
        body="Stuck on something or spotted a bug? The Discord is the fastest way to reach us — we're on there daily."
        href={settings.discordUrl}
        title="Need help? Ask in the Discord"
        variant="card"
      />
    </div>
  );
}
