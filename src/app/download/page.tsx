import Image from "next/image";
import Link from "next/link";

import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE_PATHS } from "@/lib/constants";
import { getSiteSettings } from "@/lib/sanity/content";
import { safeHref } from "@/lib/utils";

export const revalidate = 600;

const features = [
  "Fully automatic match tracking on TCGA and RiftAtlas",
  "Streamer overlay for OBS (new in 0.47)",
  "Personal matchup matrix with going-first splits",
  "Piltover Archive deck import with per-match snapshots",
  "Community meta and matrix — all in-app",
  "Turn-by-turn replay viewer — coming soon",
];

export default async function DownloadPage() {
  const settings = await getSiteSettings();
  const downloadHref = safeHref(settings.downloadUrl);

  return (
    <div className="mx-auto max-w-5xl space-y-14 px-6 py-14">
      <SectionHeading
        eyebrow="Download"
        title="Get the RiftLite desktop app."
        description="Fully automatic match tracking on TCGA and RiftAtlas, a personal matchup matrix, and a live OBS overlay. Free, Windows, no account required."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <Card className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-display text-lg font-semibold text-white">What you get</h3>
            <p className="text-sm leading-6 text-slate-400">
              Install once, play Riftbound on TCGA or RiftAtlas, and every match logs itself.
              Your stats — plus the community meta — stay up to date without the spreadsheet
              homework.
            </p>
          </div>
          <ul className="space-y-2.5">
            {features.map((f) => (
              <li className="flex items-center gap-3 text-sm text-slate-300" key={f}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-xs text-emerald-300">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href={downloadHref}>Download RiftLite</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={SITE_PATHS.guide}>How to use it</Link>
            </Button>
          </div>
          <div className="text-xs text-slate-500">Windows · free · no account required</div>
        </Card>

        <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-950/60 p-4 shadow-[0_0_60px_rgba(89,167,255,0.08)]">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-200">
              New · Streamer Overlay
            </div>
            <Image
              alt="RiftLite stream overlay configuration with live matchup preview"
              className="h-auto w-full rounded-xl"
              height={1009}
              src="/screenshots/overlay.webp"
              width={1920}
            />
          </div>
        </div>
      </div>

      {/* Feature preview grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-200">
            Community
          </div>
          <h3 className="font-display text-lg font-semibold text-white">
            The whole meta, in-app.
          </h3>
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-slate-950/60">
            <Image
              alt="Community meta inside RiftLite"
              className="h-auto w-full"
              height={819}
              src="/screenshots/community.webp"
              width={1456}
            />
          </div>
        </Card>
        <Card className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-cyan-200">
            Your stats
          </div>
          <h3 className="font-display text-lg font-semibold text-white">
            Matchup matrix, colour-coded.
          </h3>
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-slate-950/60">
            <Image
              alt="Personal stats — matchup matrix and summary"
              className="h-auto w-full"
              height={1009}
              src="/screenshots/stats-matrix.webp"
              width={1920}
            />
          </div>
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
