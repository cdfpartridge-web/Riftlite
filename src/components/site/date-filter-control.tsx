"use client";

import { dateFilterError, localDateKey, type DateFilterValue } from "@/lib/date-filter";

const inputClass = "h-11 min-w-0 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20 [color-scheme:dark]";

export function DateFilterControl({ value, onChange, label = "Date", allLabel = "All time", hidePresets = false, hideSelect = false }: {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  label?: string;
  allLabel?: string;
  hidePresets?: boolean;
  hideSelect?: boolean;
}) {
  const error = dateFilterError(value);
  return <div className="flex min-w-0 flex-wrap items-end gap-3">
    {!hideSelect ? <label className="min-w-[150px] flex-1 space-y-1.5 text-xs font-semibold text-slate-400">
      <span>{label}</span>
      <select className={inputClass} value={value.preset} onChange={(event) => {
        const preset = event.target.value as DateFilterValue["preset"];
        const from = value.from || localDateKey(new Date());
        onChange({ preset, from, to: value.to || from });
      }}>
        <option value="all">{allLabel}</option>
        {value.preset === "1d" ? <option value="1d">Last 24 hours</option> : null}
        {value.preset === "14d" ? <option value="14d">Last 14 days</option> : null}
        {!hidePresets ? <><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></> : null}
        <option value="date">Specific date</option><option value="custom">Date range</option>
      </select>
    </label> : null}
    {value.preset === "date" || value.preset === "custom" ? <label className="min-w-[150px] flex-1 space-y-1.5 text-xs font-semibold text-slate-400">
      <span>{value.preset === "date" ? "Selected date" : "From"}</span>
      <input className={inputClass} type="date" value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
    </label> : null}
    {value.preset === "custom" ? <label className="min-w-[150px] flex-1 space-y-1.5 text-xs font-semibold text-slate-400">
      <span>To</span>
      <input className={inputClass} type="date" min={value.from || undefined} value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
    </label> : null}
    {error ? <p className="w-full text-sm text-rose-300" role="alert">{error}</p> : null}
  </div>;
}
