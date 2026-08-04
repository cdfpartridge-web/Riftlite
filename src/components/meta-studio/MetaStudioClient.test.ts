import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorVideoCarouselPanel } from "@/components/meta-studio/MetaStudioClient";
import type { CreatorVideoCarouselConfig } from "@/lib/youtube/creator-video-config";

const INITIAL_CONFIG: CreatorVideoCarouselConfig = {
  enabled: true,
  rotationSeconds: 10,
  maxItems: 8,
  excludedVideoIds: [],
  pinnedVideoIds: [],
  creators: [
    {
      id: "riftlab",
      name: "Riftlab",
      spotlightId: "riftlab",
      youtubeUrl: "https://www.youtube.com/@RiftlabTCG",
      channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
      enabled: true,
      videoSlots: 4,
    },
    {
      id: "dunc",
      name: "Dunc",
      spotlightId: "dunc",
      youtubeUrl: "https://www.youtube.com/@dunctcg",
      channelId: "UCiM8nhAwh94QqH9qm9yjKYA",
      enabled: true,
      videoSlots: 1,
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("Meta Studio creator video carousel panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => cleanup());

  it("edits weighted slots and video lists, then saves with visible feedback", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ config: INITIAL_CONFIG }))
      .mockImplementationOnce(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          config: CreatorVideoCarouselConfig;
        };
        return jsonResponse({
          config: body.config,
          message: "Creator video carousel settings saved and desktop Home refreshed.",
        });
      });
    const onClose = vi.fn();
    const view = render(createElement(CreatorVideoCarouselPanel, { onClose }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Creator video carousel" })).toBeInTheDocument();
      expect(view.getByText("Total enabled video slots")).toBeInTheDocument();
      expect(view.getByText("5", { selector: "strong" })).toBeInTheDocument();
    });

    fireEvent.change(view.getByLabelText("Pinned YouTube video IDs"), {
      target: { value: "12345678901, abcdefghijk" },
    });
    fireEvent.change(view.getByLabelText("Excluded YouTube video IDs"), {
      target: { value: "abcdefghijk" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add creator" }));
    fireEvent.change(view.getByLabelText("Creator 3 name"), {
      target: { value: "New Creator" },
    });
    fireEvent.change(view.getByLabelText("Creator 3 YouTube URL"), {
      target: { value: "https://www.youtube.com/@NewCreator" },
    });
    fireEvent.change(view.getByLabelText("Creator 3 video slots"), {
      target: { value: "3" },
    });

    expect(view.getByText("8", { selector: "strong" })).toBeInTheDocument();
    expect(view.getByText("Unsaved changes.")).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Save carousel" }));

    await waitFor(() => {
      expect(view.getByText(/saved and desktop Home refreshed/i)).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/meta-studio/creator-videos");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
    const saved = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      config: CreatorVideoCarouselConfig;
    };
    expect(saved.config.pinnedVideoIds).toEqual(["12345678901", "abcdefghijk"]);
    expect(saved.config.excludedVideoIds).toEqual(["abcdefghijk"]);
    expect(saved.config.creators[2]).toMatchObject({
      id: "creator-3",
      name: "New Creator",
      youtubeUrl: "https://www.youtube.com/@NewCreator",
      videoSlots: 3,
    });
  });

  it("refreshes from the server and closes without saving", async () => {
    const refreshed = { ...INITIAL_CONFIG, rotationSeconds: 25 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ config: INITIAL_CONFIG }))
      .mockResolvedValueOnce(jsonResponse({ config: refreshed }));
    const onClose = vi.fn();
    const view = render(createElement(CreatorVideoCarouselPanel, { onClose }));

    await waitFor(() => expect(view.getByLabelText("Rotation seconds")).toHaveValue(10));
    fireEvent.click(view.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(view.getByLabelText("Rotation seconds")).toHaveValue(25);
      expect(view.getByText(/settings refreshed/i)).toBeInTheDocument();
    });
    fireEvent.click(view.getByRole("button", { name: "Close creator video carousel settings" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
