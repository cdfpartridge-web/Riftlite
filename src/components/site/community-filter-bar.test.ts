import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS } from "@/lib/constants";

const navigation = vi.hoisted(() => ({
  pathname: "/community/meta",
  push: vi.fn(),
  search: "season=vendetta-launch&range=30d",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { CommunityFilterBar } from "./community-filter-bar";

describe("CommunityFilterBar format filter", () => {
  beforeEach(() => {
    navigation.pathname = "/community/meta";
    navigation.search = "season=vendetta-launch&range=30d";
    navigation.push.mockClear();
  });

  it("only shows the format control on opted-in pages", () => {
    const hidden = render(createElement(CommunityFilterBar, {
      filters: DEFAULT_FILTERS,
    }));
    expect(hidden.queryByRole("combobox", { name: "Format" })).not.toBeInTheDocument();
    hidden.unmount();

    const shown = render(createElement(CommunityFilterBar, {
      filters: DEFAULT_FILTERS,
      showFormat: true,
    }));
    expect(shown.getByRole("combobox", { name: "Format" })).toBeInTheDocument();
  });

  it("writes a shareable format query while preserving existing filters", () => {
    const view = render(createElement(CommunityFilterBar, {
      filters: {
        ...DEFAULT_FILTERS,
        range: "30d",
        season: "vendetta-launch",
      },
      showFormat: true,
    }));

    fireEvent.change(view.getByRole("combobox", { name: "Format" }), {
      target: { value: "bo3" },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply filters" }));

    expect(navigation.push).toHaveBeenCalledTimes(1);
    const target = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(target.pathname).toBe("/community/meta");
    expect(target.searchParams.get("format")).toBe("bo3");
    expect(target.searchParams.get("range")).toBe("30d");
    expect(target.searchParams.get("season")).toBe("vendetta-launch");
    expect(target.searchParams.get("page")).toBe("1");
  });

  it("removes the format query when All formats is selected", () => {
    navigation.search = "season=vendetta-launch&format=bo3";
    const view = render(createElement(CommunityFilterBar, {
      filters: {
        ...DEFAULT_FILTERS,
        season: "vendetta-launch",
        format: "bo3",
      },
      showFormat: true,
    }));

    fireEvent.change(view.getByRole("combobox", { name: "Format" }), {
      target: { value: "" },
    });
    fireEvent.click(view.getByRole("button", { name: "Apply filters" }));

    const target = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(target.searchParams.has("format")).toBe(false);
    expect(target.searchParams.get("season")).toBe("vendetta-launch");
  });
  it("writes an individual local date, clears stale range bounds and rejects reversed ranges", () => {
    navigation.search = "range=custom&from=2026-09-01&to=2026-09-30&page=4";
    const view = render(createElement(CommunityFilterBar, { filters: { ...DEFAULT_FILTERS, range: "custom", from: "2026-09-01", to: "2026-09-30" } }));
    fireEvent.change(view.getByRole("combobox", { name: "Window" }), { target: { value: "date" } });
    fireEvent.change(view.getByLabelText("Selected date"), { target: { value: "2026-09-18" } });
    fireEvent.click(view.getByRole("button", { name: "Apply filters" }));
    const target = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(target.searchParams.get("range")).toBe("date");
    expect(target.searchParams.get("from")).toBe("2026-09-18");
    expect(target.searchParams.has("to")).toBe(false);
    expect(target.searchParams.get("page")).toBe("1");
    expect(target.searchParams.get("timeZone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    fireEvent.change(view.getByRole("combobox", { name: "Window" }), { target: { value: "custom" } });
    fireEvent.change(view.getByLabelText("To"), { target: { value: "2026-09-17" } });
    expect(view.getByRole("button", { name: "Apply filters" })).toBeDisabled();
    expect(view.getByRole("alert")).toHaveTextContent("End date must be on or after start date.");
  });

  it("preserves an explicit All seasons choice when applying dates", () => {
    const view = render(createElement(CommunityFilterBar, { filters: { ...DEFAULT_FILTERS, range: "date", from: "2026-09-18", season: "" } }));
    fireEvent.click(view.getByRole("button", { name: "Apply filters" }));
    const target = new URL(navigation.push.mock.calls[0][0], "http://localhost");
    expect(target.searchParams.has("season")).toBe(true);
    expect(target.searchParams.get("season")).toBe("");
  });

});
