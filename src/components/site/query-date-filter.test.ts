import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_DATES } from "@/lib/date-filter";

const navigation = vi.hoisted(() => ({ push: vi.fn(), search: "a=deckA&b=deckB&format=bo3" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/community/decks/compare",
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push }),
}));
import { QueryDateFilter } from "./query-date-filter";

describe("date query controls", () => {
  beforeEach(() => { navigation.push.mockClear(); navigation.search = "a=deckA&b=deckB&format=bo3"; });

  it("preserves deck choices and format when applying a date", () => {
    const view = render(createElement(QueryDateFilter, { initialValue: ALL_DATES }));
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "date" } });
    fireEvent.change(view.getByLabelText("Selected date"), { target: { value: "2026-09-18" } });
    fireEvent.click(view.getByRole("button", { name: "Apply dates" }));
    const result = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(result.searchParams.get("a")).toBe("deckA");
    expect(result.searchParams.get("b")).toBe("deckB");
    expect(result.searchParams.get("format")).toBe("bo3");
    expect(result.searchParams.get("from")).toBe("2026-09-18");
    expect(result.searchParams.get("timeZone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("clears an unapplied draft even when the URL does not change", () => {
    const view = render(createElement(QueryDateFilter, { initialValue: ALL_DATES }));
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "date" } });
    fireEvent.click(view.getByRole("button", { name: "Clear dates" }));
    expect(view.getByRole("combobox", { name: "Date" })).toHaveValue("all");
    expect(view.queryByLabelText("Selected date")).not.toBeInTheDocument();
  });

  it("accurately labels a legacy 24-hour drilldown", () => {
    const view = render(createElement(QueryDateFilter, { initialValue: { ...ALL_DATES, preset: "1d" } }));
    expect(view.getByRole("combobox", { name: "Date" })).toHaveValue("1d");
    expect(view.getByRole("option", { name: "Last 24 hours" })).toBeInTheDocument();
  });
});
