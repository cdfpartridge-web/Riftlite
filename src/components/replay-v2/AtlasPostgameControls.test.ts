import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasPostgameControls } from "./AtlasPostgameControls";
import type { useAtlasPostgame } from "./useAtlasPostgame";

function atlasState(shared = true, canManage = true): ReturnType<typeof useAtlasPostgame> {
  return {
    scope: "replay", boundaryKey: "replay:account", prepared: [], allCards: false, busy: false, error: "", mulliganSummaries: [],
    metadata: { accountId: canManage ? "owner" : "viewer", canManage, available: true, games: [{ gameId: "game-1", gameNumber: 1, frameCount: 10, sha256: "digest", shared, firstElapsedMs: 0, lastElapsedMs: 10_000 }] },
    showPlayerView: vi.fn(), showAllCards: vi.fn(async () => undefined), importFile: vi.fn(async () => true),
    setShared: vi.fn(async () => undefined), project: vi.fn(() => null),
  };
}

describe("Atlas All cards sharing controls", () => {
  const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
  });
  afterEach(() => {
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.restoreAllMocks();
  });

  it("shows the shared default without changing replay access or sharing notes, with a per-game opt-out", () => {
    const atlas = atlasState();
    const view = render(createElement(AtlasPostgameControls, { atlas, disabled: false, covered: true, onChangeView: vi.fn() }));
    fireEvent.click(view.getByRole("button", { name: "Card views" }));
    expect(view.getByText(/All cards is shared by default with people who can already access this replay/)).toHaveTextContent("Your notes stay private.");
    expect(view.getByText(/Sharing All cards does not share your private notes or change who can access this replay/)).toBeInTheDocument();
    const choice = view.getByRole("checkbox", { name: "Share All cards with replay viewers" });
    expect(choice).toBeChecked();
    fireEvent.click(choice);
    expect(atlas.setShared).toHaveBeenCalledExactlyOnceWith("game-1", false);
  });

  it("keeps an opted-out game unchecked until the owner deliberately shares it again", () => {
    const atlas = atlasState(false);
    const view = render(createElement(AtlasPostgameControls, { atlas, disabled: false, covered: true, onChangeView: vi.fn() }));
    fireEvent.click(view.getByRole("button", { name: "Card views" }));
    const choice = view.getByRole("checkbox", { name: "Share All cards with replay viewers" });
    expect(choice).not.toBeChecked();
    expect(view.getByText("10 Atlas frames · Only you")).toBeInTheDocument();
    expect(atlas.setShared).not.toHaveBeenCalled();
    fireEvent.click(choice);
    expect(atlas.setShared).toHaveBeenCalledExactlyOnceWith("game-1", true);
  });

  it("explains viewer access and private notes without exposing owner sharing controls", () => {
    const atlas = atlasState(true, false);
    const view = render(createElement(AtlasPostgameControls, { atlas, disabled: false, covered: true, onChangeView: vi.fn() }));
    fireEvent.click(view.getByRole("button", { name: "About All cards" }));
    expect(view.getByText(/All cards is available to people who can already access this replay/)).toHaveTextContent("Each viewer’s notes stay private.");
    expect(view.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(atlas.setShared).not.toHaveBeenCalled();
  });
});
