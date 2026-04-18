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
  downloadUrl: string;
};

export function SiteHeader({ downloadUrl }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[rgba(7,12,27,0.78)] backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
        <Link className="flex items-center gap-3 group" href="/">
          <Image
            alt="RiftLite"
            className="h-10 w-auto object-contain drop-shadow-[0_0_12px_rgba(89,167,255,0.5)] transition-all duration-300 group-hover:drop-shadow-[0_0_20px_rgba(89,167,255,0.7)]"
            height={40}
            priority
            src="/brand/riftlite-logo-transparent.png"
            width={160}
          />
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
          <Link href={downloadUrl || SITE_PATHS.download}>Get The App</Link>
        </Button>
      </div>
    </header>
  );
}
