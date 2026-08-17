import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

import { CasterStudioLibrary } from "./CasterStudioLibrary";

const replays = [
  replay("rl2_alpha", "Alice", "Bob", "Irelia", "Viktor"),
  replay("rl2_bravo", "Alice", "Cara", "Irelia", "Kennen"),
  replay("rl2_charlie", "Drew", "Bob", "Diana", "Viktor"),
];

describe("CasterStudioLibrary Legend filters", () => {
  beforeEach(() => {
    navigation.push.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ items: replays }),
      ok: true,
      status: 200,
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("filters independently by player and opponent Legend", async () => {
    const view = render(createElement(CasterStudioLibrary, { initialAuthorized: true }));

    await waitFor(() => expect(view.getByRole("heading", { name: "Alice vs Bob" })).toBeInTheDocument());
    expect(view.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    const playerLegend = view.getByRole("combobox", { name: "Player Legend" });
    const opponentLegend = view.getByRole("combobox", { name: "Opponent Legend" });

    expect([...playerLegend.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All player Legends",
      "Diana",
      "Irelia",
    ]);
    expect([...opponentLegend.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "All opponent Legends",
      "Kennen",
      "Viktor",
    ]);

    fireEvent.change(playerLegend, { target: { value: "irelia" } });
    expect(view.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(view.queryByRole("heading", { name: "Drew vs Bob" })).not.toBeInTheDocument();

    fireEvent.change(opponentLegend, { target: { value: "viktor" } });
    expect(view.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(view.getByRole("heading", { name: "Alice vs Bob" })).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Alice vs Cara" })).not.toBeInTheDocument();
  });
});

function replay(
  replayId: string,
  playerName: string,
  opponentName: string,
  playerLegend: string,
  opponentLegend: string,
) {
  return {
    replayId,
    status: "ready" as const,
    visibility: "private" as const,
    title: `${playerName} vs ${opponentName}`,
    platform: "atlas",
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
    listing: {
      version: 1 as const,
      playerName,
      opponentName,
      playerLegend,
      opponentLegend,
      format: "bo3" as const,
      result: "win" as const,
    },
  };
}
