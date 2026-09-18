"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { DateFilterControl } from "@/components/site/date-filter-control";
import { communityDateFilter } from "@/lib/community/filters";
import { dateFilterError, localDateKey } from "@/lib/date-filter";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { COMMUNITY_SEASONS, DEFAULT_FILTERS, LEGENDS } from "@/lib/constants";
import type { CommunityFilterParams } from "@/lib/types";

type CommunityFilterBarProps = {
  filters: CommunityFilterParams;
  showFormat?: boolean;
};

export function CommunityFilterBar({
  filters,
  showFormat = false,
}: CommunityFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState(filters);

  function update<K extends keyof CommunityFilterParams>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value, page: 1, ...(key === "range" && (value === "date" || value === "custom") ? { from: current.from || localDateKey(new Date()), to: current.to || current.from || localDateKey(new Date()) } : {}) }));
  }

  function submit() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (dateFilterError(communityDateFilter(form))) return;
    for (const [key, value] of Object.entries({ ...form, from: form.range === "date" || form.range === "custom" ? form.from : "", to: form.range === "custom" ? form.to : "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })) {
      if (key === "page" || key === "pageSize" || key === "season") {
        params.set(key, String(value));
        continue;
      }

      if (value) {
        params.set(key, String(value));
      } else {
        params.delete(key);
      }
    }
    router.push(`${pathname ?? "/community"}?${params.toString()}`);
  }

  function reset() {
    setForm(DEFAULT_FILTERS);
    router.push(pathname ?? "/community");
  }

  return (
    <Card className="rounded-[24px] p-5">
      <div className={`grid gap-4 md:grid-cols-2 ${showFormat ? "xl:grid-cols-8" : "xl:grid-cols-7"}`}>
        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Season
          </span>
          <select
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
            onChange={(event) => update("season", event.target.value)}
            value={form.season}
          >
            {COMMUNITY_SEASONS.map((season) => (
              <option key={season.label} value={season.id}>
                {season.shortLabel}
              </option>
            ))}
          </select>
        </label>

        {showFormat ? (
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
              Format
            </span>
            <select
              className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
              onChange={(event) => update("format", event.target.value)}
              value={form.format}
            >
              <option value="">All formats</option>
              <option value="bo1">Best of 1</option>
              <option value="bo3">Best of 3</option>
            </select>
          </label>
        ) : null}

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Window
          </span>
          <select
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
            onChange={(event) => update("range", event.target.value)}
            value={form.range}
          >
            <option value="">Latest 7,000</option>
            <option value="today">Today</option>
            <option value="1d">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
            <option value="date">Specific date</option>
            <option value="custom">Date range</option>
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Legend
          </span>
          <select
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
            onChange={(event) => update("legend", event.target.value)}
            value={form.legend}
          >
            <option value="">All legends</option>
            {LEGENDS.map((legend) => (
              <option key={legend} value={legend}>
                {legend}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Result
          </span>
          <select
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
            onChange={(event) => update("result", event.target.value)}
            value={form.result}
          >
            <option value="">All results</option>
            <option value="Win">Win</option>
            <option value="Loss">Loss</option>
            <option value="Draw">Draw</option>
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Seat
          </span>
          <select
            className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 text-sm text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
            onChange={(event) => update("seat", event.target.value)}
            value={form.seat}
          >
            <option value="">Any seat</option>
            <option value="1st">Went 1st</option>
            <option value="2nd">Went 2nd</option>
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Battlefield
          </span>
          <Input
            onChange={(event) => update("battlefield", event.target.value)}
            placeholder="Any battlefield"
            value={form.battlefield}
          />
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="block text-xs uppercase tracking-[0.2em] text-slate-500">
            Flags
          </span>
          <Input
            onChange={(event) => update("flags", event.target.value)}
            placeholder="Search flags"
            value={form.flags}
          />
        </label>
      </div>

      {form.range === "date" || form.range === "custom" ? <div className="mt-4 max-w-2xl"><DateFilterControl hideSelect value={communityDateFilter(form)} onChange={(value) => setForm((current) => ({ ...current, range: value.preset, from: value.from, to: value.to, page: 1 }))} /></div> : null}
      {["today", "date", "custom"].includes(form.range) ? <p className="mt-3 text-xs text-slate-400">Calendar: {filters.timeZone || "UTC"}. New selections use your local time. Dates filter available community history: the latest 7,000 records plus cached 30-day details. Older dates may have no retained data. Season and other filters still apply.</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={submit} size="sm" disabled={Boolean(dateFilterError(communityDateFilter(form)))}>
          Apply filters
        </Button>
        <Button onClick={reset} size="sm" variant="secondary">
          Clear filters
        </Button>
      </div>
    </Card>
  );
}
