import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { AdSlotConfig, AdSlotPlacement } from "@/lib/types";

type AdSlotProps = {
  slots: AdSlotConfig[];
  placement: AdSlotPlacement;
};

export function AdSlot({ slots, placement }: AdSlotProps) {
  const slot = slots.find((item) => item.placement === placement);
  if (!slot) {
    return null;
  }

  return (
    <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(20,29,61,0.92),rgba(10,16,33,0.92))]">
      <div className="space-y-4">
        <Badge>{slot.eyebrow ?? "Promotion"}</Badge>
        <div className="space-y-2">
          <CardTitle className="text-lg">{slot.title}</CardTitle>
          {slot.body ? <CardDescription>{slot.body}</CardDescription> : null}
        </div>
        {slot.mode === "adsense" ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-4 text-sm text-slate-400">
            AdSense slot placeholder: {slot.adsenseSlot ?? "configure in Sanity"}
          </div>
        ) : null}
        {slot.ctaHref && slot.ctaLabel ? (
          <Link
            className="inline-flex text-sm font-semibold text-cyan-200 underline-offset-4 hover:underline"
            href={slot.ctaHref}
          >
            {slot.ctaLabel}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
