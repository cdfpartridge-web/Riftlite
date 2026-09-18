import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/social/server", () => ({ getPublicProfileByHandle: source.get }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/user/player",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => { throw new Error("not found"); },
}));
import UserProfilePage from "./[handle]/page";

describe("public profile dates and privacy", () => {
  beforeEach(() => source.get.mockResolvedValue({
    profile: { handle: "player", displayName: "Player", showMatches: false, showDecks: false, showStats: true },
    aggregate: { recentMatches: [], totalMatches: 50, wins: 30, losses: 20, draws: 0, winRate: 60, updatedAt: 0 },
    publicReplays: [],
  }));

  it("does not invent zero dated statistics when public stats have private match history", async () => {
    const view = render(await UserProfilePage({ params: Promise.resolve({ handle: "player" }), searchParams: Promise.resolve({ range: "date", from: "2026-09-18", timeZone: "Europe/London" }) }));
    expect(view.getByText("Unavailable")).toBeInTheDocument();
    expect(view.getByText("Date breakdown unavailable while match history is private")).toBeInTheDocument();
    expect(view.queryByText("0W · 0L · 0D")).not.toBeInTheDocument();
    expect(view.getByText("Match history hidden")).toBeInTheDocument();
  });

  it("preserves shared aggregate statistics when no date filter is active", async () => {
    const view = render(await UserProfilePage({ params: Promise.resolve({ handle: "player" }), searchParams: Promise.resolve({}) }));
    expect(view.getByText("30W · 20L · 0D")).toBeInTheDocument();
    expect(view.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(view.getByText("Match history hidden")).toBeInTheDocument();
  });
});
