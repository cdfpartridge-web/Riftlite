"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { getLegendImageUrl, getLegendInitials } from "@/lib/legends";

type LegendChipProps = {
  legend: string;
  size?: number;
  href?: string;
  label?: string;
};

export function LegendChip({ legend, size = 28, href, label }: LegendChipProps) {
  const [failed, setFailed] = useState(false);
  // Defensive: incoming legend values have been observed to be null
  // (empty/unknown opponents in upstream data). Coerce so .split() and
  // image-url builders never throw at render time.
  const safeLegend = typeof legend === "string" ? legend : "";
  const display = label ?? safeLegend.split(" ")[0] ?? "—";
  const common = (
    <>
      {failed ? (
        <span
          className="flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500/30 to-violet-500/30 ring-1 ring-white/15"
          style={{ width: size, height: size, fontSize: size * 0.34 }}
        >
          <span className="font-display font-bold text-white">
            {getLegendInitials(safeLegend)}
          </span>
        </span>
      ) : (
        <Image
          alt={safeLegend}
          className="rounded-full object-cover ring-1 ring-white/15"
          height={size}
          src={getLegendImageUrl(safeLegend)}
          title={safeLegend}
          width={size}
          onError={() => setFailed(true)}
        />
      )}
      <span className="max-w-[140px] truncate text-sm text-slate-200">{display}</span>
    </>
  );

  if (!href) {
    return <span className="inline-flex items-center gap-2">{common}</span>;
  }

  return (
    <Link
      className="inline-flex items-center gap-2 rounded-full border border-transparent px-1 -mx-1 py-0.5 text-slate-200 transition-colors hover:border-white/10 hover:bg-white/[0.04]"
      href={href}
    >
      {common}
    </Link>
  );
}

export function legendHref(legend: string) {
  return `/community/legends/${encodeURIComponent(legend)}`;
}
