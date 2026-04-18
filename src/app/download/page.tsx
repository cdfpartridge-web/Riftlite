import Link from "next/link";

import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSiteSettings } from "@/lib/sanity/content";

const features = [
  "Automatic match tracking — no manual logging",
  "Share decks and matches with the community",
  "See your personal win rates and matchup history",
  "Help build the most accurate Riftbound meta stats",
];

export default async function DownloadPage() {
  const settings = await getSiteSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
      <SectionHeading
        eyebrow="Download"
        title="Get the RiftLite desktop app."
        description="Track every match you play, study your own performance, and add your games to the community stats you see here."
      />

      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-display text-lg font-semibold text-white">What you get</h3>
            <p className="text-sm leading-6 text-slate-400">
              Install once and play normally — RiftLite handles the tracking in the background and
              keeps your stats up to date.
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
