export type DateFilterValue = {
  preset: "all" | "today" | "1d" | "7d" | "14d" | "30d" | "date" | "custom";
  from: string;
  to: string;
};

export const ALL_DATES: DateFilterValue = { preset: "all", from: "", to: "" };

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function dateFilterError(filter: DateFilterValue): string {
  if (filter.preset !== "date" && filter.preset !== "custom") return "";
  if (!validDateKey(filter.from)) return "Choose a valid date.";
  if (filter.preset === "custom" && !validDateKey(filter.to)) return "Choose an end date.";
  if (filter.preset === "custom" && filter.to < filter.from) return "End date must be on or after start date.";
  return "";
}

const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
const invalidTimeZones = new Set<string>();
function calendarFormatter(value: string): Intl.DateTimeFormat {
  const cached = calendarFormatters.get(value);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: value, year: "numeric", month: "2-digit", day: "2-digit" });
  if (calendarFormatters.size >= 16) calendarFormatters.delete(calendarFormatters.keys().next().value!);
  calendarFormatters.set(value, formatter);
  return formatter;
}
export function validTimeZone(value: string): string {
  if (invalidTimeZones.has(value)) return "UTC";
  try { calendarFormatter(value); return value; }
  catch {
    if (invalidTimeZones.size >= 16) invalidTimeZones.delete(invalidTimeZones.values().next().value!);
    invalidTimeZones.add(value);
    return "UTC";
  }
}

export function timestampMs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? (value < 10_000_000_000 ? value * 1000 : value) : NaN;
  if (typeof value !== "string" || !value.trim()) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (!validDateKey(value)) return NaN;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  return Date.parse(value);
}

function calendarKey(value: unknown, timeZone?: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validDateKey(value) ? value : "";
  const ms = timestampMs(value);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  if (!timeZone) return localDateKey(date);
  const parts = calendarFormatter(validTimeZone(timeZone)).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar comparisons keep whole days inclusive across local time and DST. */
export function isInDateFilter(value: unknown, filter: DateFilterValue, now = new Date(), timeZone?: string): boolean {
  if (filter.preset === "all") return true;
  if (dateFilterError(filter)) return false;
  if (filter.preset === "1d" || filter.preset === "14d") {
    const ms = timestampMs(value);
    return Number.isFinite(ms) && ms >= now.getTime() - (filter.preset === "1d" ? 1 : 14) * 86_400_000 && ms <= now.getTime();
  }
  const day = calendarKey(value, timeZone);
  if (!day) return false;
  if (filter.preset === "date") return day === filter.from;
  if (filter.preset === "custom") return day >= filter.from && day <= filter.to;
  const today = calendarKey(now.getTime(), timeZone);
  if (filter.preset === "today") return day === today;
  const start = new Date(`${today}T12:00:00`);
  start.setDate(start.getDate() - (filter.preset === "7d" ? 6 : 29));
  return day >= localDateKey(start) && day <= today;
}
