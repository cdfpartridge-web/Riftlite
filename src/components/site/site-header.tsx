import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SITE_PATHS } from "@/lib/constants";

const primaryLinks = [
  { href: SITE_PATHS.leaderboard, label: "Leaderboard" },
  { href: SITE_PATHS.meta, label: "Meta" },
  { href: SITE_PATHS.matrix, label: "Matrix" },
  { href: SITE_PATHS.decks, label: "Decks" },
  { href: SITE_PATHS.news, label: "News" },
];

type SiteHeaderProps = {
  downloadUrl?: string;
};

export function SiteHeader({}: SiteHeaderProps = {}) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[rgba(7,12,27,0.78)] backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
        <Link className="flex items-center gap-3 group" href="/">
          <Image
            alt="RiftLite"
            className="h-11 w-11 rounded-2xl object-cover shadow-[0_0_28px_rgba(89,167,255,0.4)] transition-shadow duration-300 group-hover:shadow-[0_0_40px_rgba(89,167,255,0.6)]"
            height={44}
            priority
            src="/brand/riftlite-logo-ui.png"
            width={44}
          />
          <div>
            <div className="font-display text-[17px] font-bold tracking-tight text-white">RiftLite</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              Community Stats
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 lg:flex">
          {primaryLinks.map((link) => (
            <Link
              className="nav-link text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Button asChild size="sm">
          <Link href={SITE_PATHS.download}>Get The App</Link>
        </Button>
      </div>
    </header>
  );
}
