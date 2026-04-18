"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LEGENDS } from "@/lib/constants";
import type { CommunityFilterParams } from "@/lib/types";

type CommunityFilterBarProps = {
  filters: CommunityFilterParams;
};

export function CommunityFilterBar({ filters }: CommunityFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form, setForm] = useState(filters);

  function update<K extends keyof CommunityFilterParams>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value, page: 1 }));
  }

  function submit() {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(form)) {
      if (key === "page" || key === "pageSize") {
        params.set(key, String(value));
        continue;
      }

      if (value) {
        params.set(key, String(value));
      } else {
        params.delete(key);
      }
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function reset() {
    router.push(pathname);
  }

  return (
    <Card className="rounded-[24px] p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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

      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={submit} size="sm">
          Apply filters
        </Button>
        <Button onClick={reset} size="sm" variant="secondary">
          Clear filters
        </Button>
      </div>
    </Card>
  );
}
