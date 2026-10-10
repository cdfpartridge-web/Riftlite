import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "season=&range=7d" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/community/decks/compare",
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn() }),
}));
import { LegendChip } from "./legend-chip";
import { DeckComparePicker } from "./deck-compare-picker";
import { CommunityNav } from "./community-nav";

describe("season-preserving drilldowns", () => {
  it.each(["", "vendetta-launch", "radiance-preseason"])("keeps season %s in legend, deck cancel and community navigation", (season) => {
    navigation.search = new URLSearchParams({ season, range: "7d" }).toString();
    const legend = render(createElement(LegendChip, { legend: "Annie", href: "/community/legends/Annie" }));
    expect(new URL(legend.getByRole("link").getAttribute("href")!, "http://localhost").searchParams.get("season")).toBe(season);
    legend.unmount();
    const picker = render(createElement(DeckComparePicker, { decks: [], initialA: "deck-a", initialB: "deck-b" }));
    expect(new URL(picker.getByRole("link", { name: "Cancel" }).getAttribute("href")!, "http://localhost").searchParams.get("season")).toBe(season);
    picker.unmount();
    const nav = render(createElement(CommunityNav));
    expect(new URL(nav.getByRole("link", { name: "Legend Meta" }).getAttribute("href")!, "http://localhost").searchParams.get("season")).toBe(season);
  });
});
