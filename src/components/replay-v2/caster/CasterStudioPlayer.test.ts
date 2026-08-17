import { createElement } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ player: vi.fn() }));

vi.mock("@/components/replay-v2", () => ({
  ReplayV2Player: (props: Record<string, unknown>) => {
    mocks.player(props);
    return createElement("div", { "data-testid": "replay-player" });
  },
}));

vi.mock("./CasterStudioAccess", () => ({
  CasterStudioAccess: () => createElement("div", { "data-testid": "caster-access" }),
}));

import { CasterStudioPlayer } from "./CasterStudioPlayer";

describe("CasterStudioPlayer", () => {
  beforeEach(() => mocks.player.mockClear());

  it("fails closed to the account gate without an approved session", () => {
    const view = render(createElement(CasterStudioPlayer, {
      initialAuthorized: false,
      replayId: `rl2_${"a".repeat(32)}`,
    }));

    expect(view.getByTestId("caster-access")).toBeInTheDocument();
    expect(mocks.player).not.toHaveBeenCalled();
  });

  it("uses the private caster replay API for an authorized session", () => {
    const replayId = `rl2_${"b".repeat(32)}`;
    const view = render(createElement(CasterStudioPlayer, {
      initialAuthorized: true,
      replayId,
    }));

    expect(view.getByTestId("replay-player")).toBeInTheDocument();
    expect(mocks.player).toHaveBeenLastCalledWith({
      apiBasePath: "/api/meta-studio/caster/replays",
      allowPlayerNameHiding: true,
      casterLibraryHref: "/meta-studio/caster",
      mode: "caster",
      replayId,
    });
  });

  it("uses the public v2 API only for the explicit development preview", () => {
    const replayId = `rl2_${"c".repeat(32)}`;
    render(createElement(CasterStudioPlayer, {
      initialAuthorized: false,
      preview: true,
      replayId,
    }));

    expect(mocks.player).toHaveBeenLastCalledWith({
      apiBasePath: "/api/v2/replays",
      allowPlayerNameHiding: false,
      casterLibraryHref: "/meta-studio/caster?preview=1",
      mode: "caster",
      replayId,
    });
  });
});
