import Link from "next/link";

import { Button } from "@/components/ui/button";
import { safeHref } from "@/lib/utils";

type DiscordCtaProps = {
  href: string | undefined | null;
  variant?: "banner" | "card";
  title?: string;
  body?: string;
  ctaLabel?: string;
};

function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 127.14 96.36"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

export function DiscordCta({
  href,
  variant = "banner",
  title,
  body,
  ctaLabel = "Join the Discord",
}: DiscordCtaProps) {
  if (!href) {
    return null;
  }

  const safe = safeHref(href);
  const resolvedTitle = title ?? "Join the RiftLite Discord";
  const resolvedBody =
    body ??
    "Talk Riftbound with players, share lists, catch the next balance update first, and get help from the community.";

  if (variant === "card") {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-[#5865F2]/30 bg-[linear-gradient(135deg,rgba(88,101,242,0.18),rgba(88,101,242,0.04))] p-6 shadow-[0_0_40px_rgba(88,101,242,0.1)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#5865F2]/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-[#5865F2] text-white shadow-[0_4px_20px_rgba(88,101,242,0.4)]">
              <DiscordLogo className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="font-display text-lg font-semibold text-white">
                {resolvedTitle}
              </div>
              <p className="max-w-md text-sm leading-6 text-slate-400">{resolvedBody}</p>
            </div>
          </div>
          <Button
            asChild
            className="bg-[#5865F2] bg-none text-white shadow-[0_0_0_1px_rgba(88,101,242,0.6),0_4px_20px_rgba(88,101,242,0.35)] hover:brightness-110"
          >
            <Link href={safe} rel="noopener noreferrer" target="_blank">
              {ctaLabel}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-[#5865F2]/30 bg-[linear-gradient(135deg,rgba(88,101,242,0.22),rgba(22,31,77,0.45))] p-8 shadow-[0_0_60px_rgba(88,101,242,0.12)] md:p-12">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#5865F2]/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-5">
          <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-[#5865F2] text-white shadow-[0_6px_30px_rgba(88,101,242,0.5)]">
            <DiscordLogo className="h-8 w-8" />
          </div>
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-[#5865F2]/30 bg-[#5865F2]/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.26em] text-[#c7ccff]">
              Community
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-white md:text-3xl">
              {resolvedTitle}
            </h2>
            <p className="max-w-xl text-base leading-7 text-slate-300">{resolvedBody}</p>
          </div>
        </div>
        <Button
          asChild
          className="bg-[#5865F2] bg-none px-7 py-3.5 text-base text-white shadow-[0_0_0_1px_rgba(88,101,242,0.6),0_6px_30px_rgba(88,101,242,0.45)] hover:brightness-110"
          size="lg"
        >
          <Link href={safe} rel="noopener noreferrer" target="_blank">
            {ctaLabel}
          </Link>
        </Button>
      </div>
    </section>
  );
}

export { DiscordLogo };
