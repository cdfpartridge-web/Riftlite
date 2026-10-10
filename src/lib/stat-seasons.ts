import { validDateKey } from "@/lib/date-filter";

export const VENDETTA_PREVIEW_START_MS = Date.UTC(2026, 6, 6);
export const VENDETTA_LAUNCH_START_MS = Date.UTC(2026, 6, 31);
export const RADIANCE_PRESEASON_START_AT = "2026-10-10T16:35:38.000Z";
export const RADIANCE_PRESEASON_START_MS = Date.parse(RADIANCE_PRESEASON_START_AT);
export const CURRENT_STAT_SEASON = "radiance-preseason";

export const STAT_SEASONS = [
  { id: CURRENT_STAT_SEASON, label: "Radiance pre-season" },
  { id: "vendetta-launch", label: "Vendetta season" },
  { id: "vendetta-preview", label: "Vendetta preview" },
  { id: "pre-vendetta", label: "Pre-Vendetta" },
  { id: "", label: "All seasons" },
] as const;
export type StatSeason = (typeof STAT_SEASONS)[number]["id"];

function timestamp(value: unknown): number {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric < 10_000_000_000 ? numeric * 1000 : numeric : 0;
  }
  if (typeof value !== "string" || !value.trim()) return 0;
  // Date-only history stays at the start of its recorded day. An upload later
  // that day must not move a match across an exact mid-day season boundary.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !validDateKey(value)) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function statMatchTimestamp(match: { capturedAt?: unknown; date?: unknown; createdAt?: unknown }): number | null {
  for (const value of [match.capturedAt, match.date]) {
    if (value !== undefined && value !== null && String(value).trim()) return timestamp(value) || null;
  }
  return timestamp(match.createdAt) || null;
}

/** Calendar filters retain a recorded date-only day without inventing a timezone. */
export function statMatchDateValue(match: { capturedAt?: unknown; date?: unknown; createdAt?: unknown }): string | number | null {
  const recorded = [match.capturedAt, match.date].find((value) => value !== undefined && value !== null && String(value).trim());
  if (typeof recorded === "string" && /^\d{4}-\d{2}-\d{2}$/.test(recorded)) return validDateKey(recorded) ? recorded : null;
  return statMatchTimestamp(match);
}

export function statSeasonForTimestamp(value: number): Exclude<StatSeason, ""> {
  if (value >= RADIANCE_PRESEASON_START_MS) return CURRENT_STAT_SEASON;
  if (value >= VENDETTA_LAUNCH_START_MS) return "vendetta-launch";
  if (value >= VENDETTA_PREVIEW_START_MS) return "vendetta-preview";
  return "pre-vendetta";
}

export function isInStatSeason(value: number | null, season: string): boolean {
  if (!season) return true;
  return value !== null && Number.isFinite(value) && value > 0 && statSeasonForTimestamp(value) === season;
}
