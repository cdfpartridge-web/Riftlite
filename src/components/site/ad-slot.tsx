import Link from "next/link";

import { AdSenseUnit } from "@/components/site/adsense-unit";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { AdSlotConfig, AdSlotPlacement } from "@/lib/types";
import { safeHref } from "@/lib/utils";

const DEFAULT_ADSENSE_CLIENT = "ca-pub-1277251394011398";

type AdSlotProps = {
  slots: AdSlotConfig[];
  placement: AdSlotPlacement;
};

export function AdSlot({ slots, placement }: AdSlotProps) {
  const slot = slots.find((item) => item.placement === placement);
  if (!slot) {
    return null;
  }

  if (slot.mode === "adsense") {
    const client = slot.adsenseClient || DEFAULT_ADSENSE_CLIENT;
    if (!slot.adsenseSlot) {
      return null;
    }
    return (
      <div className="my-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">
          Advertisement
        </div>
        <AdSenseUnit client={client} slot={slot.adsenseSlot} />
      </div>
    );
  }

  return (
    <Card className="overflow-hidden bg-[linear-gradient(145deg,rgba(20,29,61,0.92),rgba(10,16,33,0.92))]">
      <div className="space-y-4">
        <Badge>{slot.eyebrow ?? "Promotion"}</Badge>
        <div className="space-y-2">
          <CardTitle className="text-lg">{slot.title}</CardTitle>
          {slot.body ? <CardDescription>{slot.body}</CardDescription> : null}
        </div>
        {slot.ctaHref && slot.ctaLabel ? (
          <Link
            className="inline-flex text-sm font-semibold text-cyan-200 underline-offset-4 hover:underline"
            href={safeHref(slot.ctaHref)}
          >
            {slot.ctaLabel}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
