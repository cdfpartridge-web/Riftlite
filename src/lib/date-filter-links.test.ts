import { describe, expect, it } from "vitest";
import { withDateFilterQuery } from "./date-filter-links";

describe("date-preserving report drilldowns", () => {
  const source = new URLSearchParams("range=custom&from=2026-09-01&to=2026-09-18&timeZone=Europe%2FLondon&season=vendetta-launch&format=bo3&page=8&search=private");
  it("preserves dates and report scope without carrying pagination or searches", () => {
    const result = new URL(withDateFilterQuery("/community/decks/sample#matches", source), "http://localhost");
    expect(result.searchParams.get("from")).toBe("2026-09-01");
    expect(result.searchParams.get("to")).toBe("2026-09-18");
    expect(result.searchParams.get("timeZone")).toBe("Europe/London");
    expect(result.searchParams.get("season")).toBe("vendetta-launch");
    expect(result.searchParams.get("format")).toBe("bo3");
    expect(result.searchParams.has("page")).toBe(false);
    expect(result.searchParams.has("search")).toBe(false);
    expect(result.hash).toBe("#matches");
  });
  it("retains explicit target choices and leaves external or unrelated links untouched", () => {
    expect(withDateFilterQuery("/community/meta?range=30d", source)).toContain("range=30d");
    expect(withDateFilterQuery("https://example.com/community/meta", source)).toBe("https://example.com/community/meta");
    expect(withDateFilterQuery("/account", source)).toBe("/account");
  });
  it("retains explicit All seasons when returning to a community report", () => {
    expect(withDateFilterQuery("/community/meta", new URLSearchParams("season=&range=date&from=2026-09-18"))).toContain("season=");
  });

});
