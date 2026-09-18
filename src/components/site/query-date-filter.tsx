"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DateFilterControl } from "@/components/site/date-filter-control";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ALL_DATES, dateFilterError, validTimeZone, type DateFilterValue } from "@/lib/date-filter";

export function QueryDateFilter({ initialValue, description = "Dates filter the available history on this page. Both ends of a date range are included." }: {
  initialValue: DateFilterValue;
  description?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  function apply(clear = false) {
    if (!clear && dateFilterError(value)) return;
    if (clear) setValue(ALL_DATES);
    const params = new URLSearchParams(search?.toString());
    for (const key of ["range", "from", "to", "timeZone", "page"]) params.delete(key);
    if (!clear && value.preset !== "all") {
      params.set("range", value.preset);
      if (value.preset === "date" || value.preset === "custom") params.set("from", value.from);
      if (value.preset === "custom") params.set("to", value.to);
      params.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }
  return <Card className="space-y-3 p-4">
    <DateFilterControl value={value} onChange={setValue} allLabel="Available history" />
    <p className="text-xs text-slate-400">{description} Calendar: {search?.get("timeZone") ? validTimeZone(search.get("timeZone")!) : initialValue.preset === "all" ? "local time" : "UTC"}. New selections use your local time.</p>
    <div className="flex flex-wrap gap-3"><Button size="sm" disabled={Boolean(dateFilterError(value))} onClick={() => apply()}>Apply dates</Button><Button size="sm" variant="secondary" onClick={() => apply(true)}>Clear dates</Button></div>
  </Card>;
}
