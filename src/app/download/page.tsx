import Link from "next/link";

import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE_PATHS } from "@/lib/constants";
import { getSiteSettings } from "@/lib/sanity/content";
import { safeHref } from "@/lib/utils";

export const revalidate = 600;

const features = [
  "Fast match logging — most fields fill themselves in",
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
              Install once, log each match in a couple of taps, and your stats — plus the community
              meta — stay up to date without the spreadsheet homework.
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
            <Link href={safeHref(settings.downloadUrl)}>Download RiftLite</Link>
          </Button>
        </Card>
      </div>

      {/* How to use CTA */}
      <Card className="relative overflow-hidden bg-[linear-gradient(135deg,rgba(89,167,255,0.14),rgba(166,124,255,0.12))]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-60 w-60 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200 shadow-[0_0_20px_rgba(89,167,255,0.2)]">
              <svg
                aria-hidden="true"
                className="h-6 w-6"
                fill="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-200">
                New here?
              </div>
              <h3 className="font-display text-xl font-semibold text-white">
                Watch the video guide first
              </h3>
              <p className="max-w-md text-sm leading-6 text-slate-400">
                A short walkthrough covering install, first match tracking, and sharing your stats
                with the community.
              </p>
            </div>
          </div>
          <Button asChild size="lg" variant="secondary">
            <Link href={SITE_PATHS.guide}>How to Use RiftLite</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
