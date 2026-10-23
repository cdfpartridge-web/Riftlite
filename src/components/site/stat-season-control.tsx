import { STAT_SEASONS } from "@/lib/stat-seasons";

export function RadianceSeasonNotice() {
  return <aside aria-label="Radiance season" className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-sm text-slate-200">
    <strong className="text-amber-100">Radiance season is here</strong>
    <p className="mt-1 text-xs leading-relaxed text-slate-300">Official season stats start from 23 October 2026 at 13:11:27 UK time. Radiance season is now the default. Your pre-season and older results are preserved: choose another season or All seasons to see them.</p>
  </aside>;
}

export function StatSeasonControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="block space-y-2 text-sm text-slate-300">
    <span>Season</span>
    <select className="h-11 w-full max-w-xs rounded-2xl border border-white/10 bg-slate-950 px-3 text-sm text-white focus:border-cyan-300/60" value={value} onChange={(event) => onChange(event.target.value)}>
      {STAT_SEASONS.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}
    </select>
  </label>;
}
