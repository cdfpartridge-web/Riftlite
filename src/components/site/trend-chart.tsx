import type { TrendBucket } from "@/lib/community/profiles";

type TrendChartProps = {
  buckets: TrendBucket[];
  /** Unit suffix shown on the Y-axis numbers. */
  unit?: string;
  /** If provided, overrides the value plotted on the line for each bucket. */
  valueKey?: "winRate" | "games";
  /** Colour of the line + area fill. */
  accent?: string;
  /** Label the chart — appears below the title area for screen readers. */
  label: string;
};

const WIDTH = 560;
const HEIGHT = 140;
const PADDING = { top: 14, right: 12, bottom: 28, left: 32 };

export function TrendChart({
  buckets,
  unit = "%",
  valueKey = "winRate",
  accent = "#59A7FF",
  label,
}: TrendChartProps) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-6 text-center text-xs text-slate-500">
        Not enough data to plot {label}.
      </div>
    );
  }

  const values = buckets.map((b) => b[valueKey]);
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxValue =
    valueKey === "games"
      ? Math.max(1, ...values)
      : Math.max(100, ...values); // WR always to 100% ceiling
  const stepX = innerW / Math.max(1, buckets.length - 1);

  const points = buckets.map((b, i) => {
    const v = b[valueKey];
    const ratio = maxValue === 0 ? 0 : v / maxValue;
    const x = PADDING.left + stepX * i;
    const y = PADDING.top + innerH * (1 - ratio);
    return { x, y, bucket: b, value: v };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)} ${(PADDING.top + innerH).toFixed(1)} L${points[0].x.toFixed(1)} ${(PADDING.top + innerH).toFixed(1)} Z`;

  const gridLines = valueKey === "games" ? [0.5, 1] : [0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-3">
      <svg
        aria-label={label}
        className="w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
      >
        {/* Grid */}
        {gridLines.map((ratio) => {
          const y = PADDING.top + innerH * (1 - ratio);
          const v = Math.round(maxValue * ratio);
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="rgba(148,163,184,0.8)"
              >
                {v}
                {unit}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <defs>
          <linearGradient id={`trend-${label.replace(/\W+/g, "")}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.45" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={areaPath}
          fill={`url(#trend-${label.replace(/\W+/g, "")})`}
          stroke="none"
        />

        {/* Line */}
        <path d={linePath} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p) => (
          <g key={`${p.bucket.startMs}-${p.x}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r="3"
              fill="#0B1226"
              stroke={accent}
              strokeWidth="1.5"
            />
            <title>{`Week of ${p.bucket.label} - ${p.bucket.games} games - ${p.value}${unit}`}</title>
          </g>
        ))}

        {/* X labels */}
        {points.map((p, i) => {
          if (buckets.length > 8 && i % 2 !== 0) return null;
          return (
            <text
              key={`lbl-${p.bucket.startMs}`}
              x={p.x}
              y={HEIGHT - 8}
              fontSize="9"
              fill="rgba(148,163,184,0.7)"
              textAnchor="middle"
            >
              {p.bucket.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
