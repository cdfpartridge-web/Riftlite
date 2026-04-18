"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/community/leaderboard", label: "Leaderboard" },
  { href: "/community/meta", label: "Legend Meta" },
  { href: "/community/matrix", label: "Match Matrix" },
  { href: "/community/matches", label: "Recent Matches" },
  { href: "/community/decks", label: "Decks" },
];

export function CommunityNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200",
              active
                ? "border-cyan-300/50 bg-cyan-300/12 text-white shadow-[0_0_16px_rgba(89,167,255,0.15)]"
                : "border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-cyan-300/30 hover:bg-white/[0.06] hover:text-white",
            )}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
