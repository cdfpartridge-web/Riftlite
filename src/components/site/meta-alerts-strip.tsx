import { Card } from "@/components/ui/card";
import type { MetaAlert } from "@/lib/community/meta-alerts";

type MetaAlertsStripProps = {
  alerts: MetaAlert[];
};

function ToneIcon({ tone }: { tone: MetaAlert["tone"] }) {
  if (tone === "up") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-4 w-4"
        fill="currentColor"
      >
        <path d="M10 3.5a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 0 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V4.25A.75.75 0 0 1 10 3.5Z" transform="rotate(180 10 10)" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path d="M10 3.5a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 0 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V4.25A.75.75 0 0 1 10 3.5Z" />
    </svg>
  );
}

export function MetaAlertsStrip({ alerts }: MetaAlertsStripProps) {
  const hasAlerts = alerts.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Live intel
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-white">
            Meta alerts
          </h2>
          <p className="text-sm leading-6 text-slate-400">
            High-confidence shifts from the most recent community matches compared to the window just before.
          </p>
        </div>
      </div>

      {hasAlerts ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {alerts.map((alert) => {
            const isUp = alert.tone === "up";
            const accent = isUp ? "#49C187" : "#FF6B7A";
            const badgeBg = isUp ? "rgba(73,193,135,0.14)" : "rgba(255,107,122,0.14)";
            const glow = isUp ? "rgba(73,193,135,0.15)" : "rgba(255,107,122,0.15)";

            return (
              <Card
                key={alert.dedupe}
                className="relative flex h-full flex-col gap-3 overflow-hidden rounded-[22px] p-5"
                style={{
                  boxShadow: `0 8px 32px rgba(4,8,23,0.5), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.06)`,
                }}
              >
                <div
                  className="pointer-events-none absolute right-6 top-4 h-20 w-20 rounded-full blur-2xl"
                  style={{ background: glow }}
                />
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ background: badgeBg, color: accent }}
                  >
                    <ToneIcon tone={alert.tone} />
                    {isUp ? "Trending up" : "Cooling off"}
                  </span>
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: accent }}
                  >
                    {alert.metric}
                  </span>
                </div>
                <h3 className="relative font-display text-base font-semibold leading-snug tracking-tight text-white">
                  {alert.title}
                </h3>
                <p className="relative text-sm leading-6 text-slate-400">
                  {alert.summary}
                </p>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card
          className="rounded-[22px] p-6"
          style={{
            boxShadow: `0 8px 32px rgba(4,8,23,0.5), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.06)`,
          }}
        >
          <p className="text-sm leading-6 text-slate-400">
            No strong meta shifts detected yet. Check back once more community matches land.
          </p>
        </Card>
      )}
    </section>
  );
}
