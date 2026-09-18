import { describe, expect, it } from "vitest";
import { ALL_DATES, dateFilterError, isInDateFilter, validDateKey, type DateFilterValue } from "./date-filter";

const oneDay: DateFilterValue = { preset: "date", from: "2026-09-18", to: "" };

describe("calendar date filters", () => {
  it("includes local midnight through the end of a day rather than UTC midnight", () => {
    expect(isInDateFilter("2026-09-17T23:00:00Z", oneDay, new Date(), "Europe/London")).toBe(true);
    expect(isInDateFilter("2026-09-18T22:59:59.999Z", oneDay, new Date(), "Europe/London")).toBe(true);
    expect(isInDateFilter("2026-09-18T23:00:00Z", oneDay, new Date(), "Europe/London")).toBe(false);
    expect(isInDateFilter("2026-09-18", oneDay, new Date(), "America/Los_Angeles")).toBe(true);
  });

  it("includes both ends across the short and long London DST days", () => {
    for (const [day, start, end] of [
      ["2026-03-29", "2026-03-29T00:00:00Z", "2026-03-29T22:59:59Z"],
      ["2026-10-25", "2026-10-24T23:00:00Z", "2026-10-25T23:59:59Z"],
    ]) {
      const filter = { ...oneDay, from: day };
      expect(isInDateFilter(start, filter, new Date(), "Europe/London")).toBe(true);
      expect(isInDateFilter(end, filter, new Date(), "Europe/London")).toBe(true);
      expect(isInDateFilter(Date.parse(end) + 1000, filter, new Date(), "Europe/London")).toBe(false);
    }
  });

  it("validates exact dates and excludes invalid, missing and reversed dates", () => {
    expect(validDateKey("2026-02-29")).toBe(false);
    expect(validDateKey("2028-02-29")).toBe(true);
    expect(validDateKey("2026-13-01")).toBe(false);
    expect(dateFilterError({ ...oneDay, preset: "custom", to: "2026-09-17" })).toMatch(/on or after/);
    expect(isInDateFilter("2026-09-18", { ...oneDay, preset: "custom", to: "" })).toBe(false);
    expect(isInDateFilter(undefined, oneDay)).toBe(false);
    expect(isInDateFilter("nonsense", oneDay)).toBe(false);
    expect(isInDateFilter(undefined, ALL_DATES)).toBe(true);
  });

  it("includes the selected final day and understands seconds timestamps", () => {
    const filter: DateFilterValue = { preset: "custom", from: "2026-09-17", to: "2026-09-18" };
    expect(isInDateFilter("2026-09-18T23:59:59Z", filter, new Date(), "UTC")).toBe(true);
    expect(isInDateFilter(Date.parse("2026-09-18T12:00:00Z") / 1000, filter, new Date(), "UTC")).toBe(true);
    expect(isInDateFilter("2026-09-19T00:00:00Z", filter, new Date(), "UTC")).toBe(false);
  });

  it("uses calendar days for rolling local presets and excludes future days", () => {
    const filter: DateFilterValue = { ...ALL_DATES, preset: "7d" };
    const now = new Date("2026-09-18T12:00:00Z");
    expect(isInDateFilter("2026-09-12", filter, now)).toBe(true);
    expect(isInDateFilter("2026-09-11", filter, now)).toBe(false);
    expect(isInDateFilter("2026-09-19", filter, now)).toBe(false);
  });
});
