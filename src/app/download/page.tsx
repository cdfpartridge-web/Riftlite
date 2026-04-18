import Link from "next/link";

import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSiteSettings } from "@/lib/sanity/content";

const features = [
  "Automatic match capture and sync",
  "Deck snapshot sharing",
  "Live community feed contribution",
  "Matchup tracking across legends",
];

export default async function DownloadPage() {
  const settings = await getSiteSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
      <SectionHeading
        eyebrow="Download"
        title="Install RiftLite and start contributing to the public stats."
        description="The desktop app is the source of truth for captured matches and shared deck snapshots. Everything you see on this site comes from players like you."
      />

      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-display text-lg font-semibold text-white">What you get</h3>
            <p className="text-sm leading-6 text-slate-400">
              Install once and every match you play is automatically structured, synced, and
              reflected in the community stats here.
            </p>
          </div>
          <ul className="space-y-2.5">
            {features.map((f) => (
              <li className="flex items-center gap-3 text-sm text-slate-300" key={f}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300 text-xs">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <Button asChild size="lg">
            <Link href={settings.downloadUrl}>Download RiftLite</Link>
          </Button>
        </Card>
      </div>
    </div>
  );
}
