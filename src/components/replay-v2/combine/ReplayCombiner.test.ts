import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replayUser = {
  email: "player@example.com",
  getIdToken: vi.fn(async () => "firebase-token"),
  isAnonymous: false,
};

vi.mock("firebase/auth", () => ({
  getAuth: () => ({}),
  onIdTokenChanged: (
    _auth: unknown,
    onUser: (user: typeof replayUser) => void,
  ) => {
    onUser(replayUser);
    return () => undefined;
  },
}));

vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { ReplayCombiner } from "./ReplayCombiner";

describe("public replay combiner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    replayUser.getIdToken.mockClear();
  });

  it("creates an owned unlisted replay and links directly to My replays", async () => {
    const replayId = `rl2_${"c".repeat(32)}`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      replay: { replayId, visibility: "unlisted" },
      created: true,
      playerPath: `/replays/${replayId}`,
      confidence: "exact",
      diagnostics: {
        primarySourceReplayId: `rl2_${"a".repeat(32)}`,
        pairedSnapshotEvents: 4,
        pairedActionEvents: 12,
        unpairedPrimaryEvents: 0,
        unpairedSecondaryEvents: 0,
        enrichedCards: 7,
        enrichedFields: 18,
        coveragePercent: 100,
        warningCodes: [],
      },
    }), {
      headers: { "content-type": "application/json" },
      status: 201,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(createElement(ReplayCombiner));

    fireEvent.change(view.getByLabelText(/Player one's perspective/i), {
      target: { value: `rl2_${"a".repeat(32)}` },
    });
    fireEvent.change(view.getByLabelText(/Player two's perspective/i), {
      target: { value: `rl2_${"b".repeat(32)}` },
    });
    fireEvent.click(view.getByRole("checkbox", { name: /I have both players' permission/i }));
    fireEvent.click(view.getByRole("button", { name: "Create unlisted combined replay" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Your unlisted team replay has been created." }))
        .toBeInTheDocument();
    });
    expect(replayUser.getIdToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/replays/combine",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer firebase-token" }),
      }),
    );
    expect(view.getByRole("link", { name: "View in My replays" }))
      .toHaveAttribute("href", "/replays?scope=mine");
    expect(view.getByRole("link", { name: /Open combined replay/i }))
      .toHaveAttribute("href", `/replays/${replayId}`);
  });
});
