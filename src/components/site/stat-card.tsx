import { Card } from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: string;
  tone?: "default" | "win" | "loss";
};

export function StatCard({ label, value, tone = "default" }: StatCardProps) {
  const toneColor =
    tone === "win"
      ? "var(--brand-win)"
      : tone === "loss"
        ? "var(--brand-loss)"
        : "var(--brand-gold-light)";

  const glowColor =
    tone === "win"
      ? "rgba(73,193,135,0.15)"
      : tone === "loss"
        ? "rgba(255,107,122,0.15)"
        : "rgba(132,231,255,0.1)";

  return (
    <Card
      className="relative overflow-hidden rounded-[24px] p-5"
      style={{ boxShadow: `0 8px 32px rgba(4,8,23,0.5), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.06)` }}
    >
      {/* subtle glow behind value */}
      <div
        className="pointer-events-none absolute right-4 top-4 h-16 w-16 rounded-full blur-2xl"
        style={{ background: glowColor }}
      />
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </div>
      <div
        className="relative mt-3 font-display text-3xl font-bold tracking-tight"
        style={{ color: toneColor }}
      >
        {value}
      </div>
    </Card>
  );
}
