import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreatorVideoCarouselPanel,
  LiveTakeoverPanel,
} from "@/components/meta-studio/MetaStudioClient";
import type { LiveTakeoverConfig } from "@/lib/live-takeover";
import type { CreatorVideoCarouselConfig } from "@/lib/youtube/creator-video-config";

const INITIAL_CONFIG: CreatorVideoCarouselConfig = {
  enabled: true,
  rotationSeconds: 10,
  maxItems: 8,
  excludedVideoIds: [],
  includedVideoIds: [],
  pinnedVideoIds: [],
  creators: [
    {
      id: "riftlab",
      name: "Riftlab",
      spotlightId: "riftlab",
      youtubeUrl: "https://www.youtube.com/@RiftlabTCG",
      channelId: "UCDFo4wpERqN20cMxs3WzPsQ",
      sourceMode: "all",
      playlistId: "",
      enabled: true,
      videoSlots: 4,
    },
    {
      id: "dunc",
      name: "Dunc",
      spotlightId: "dunc",
      youtubeUrl: "https://www.youtube.com/@dunctcg",
      channelId: "UCiM8nhAwh94QqH9qm9yjKYA",
      sourceMode: "riftbound",
      playlistId: "",
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
    fireEvent.change(view.getByLabelText("Always include YouTube video IDs"), {
      target: { value: "12345678901" },
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
    fireEvent.change(view.getByLabelText("Creator 3 source mode"), {
      target: { value: "playlist" },
    });
    fireEvent.change(view.getByLabelText("Creator 3 playlist URL or ID"), {
      target: { value: "https://www.youtube.com/playlist?list=PLQfZRuxub-RU" },
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
    expect(saved.config.includedVideoIds).toEqual(["12345678901"]);
    expect(saved.config.creators[2]).toMatchObject({
      id: "creator-3",
      name: "New Creator",
      youtubeUrl: "https://www.youtube.com/@NewCreator",
      sourceMode: "playlist",
      playlistId: "https://www.youtube.com/playlist?list=PLQfZRuxub-RU",
      videoSlots: 3,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/meta-studio/creator-videos?preview=1");
  });

  it("turns preview decisions into include and hide overrides", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        config: INITIAL_CONFIG,
        preview: [{
          creatorId: "dunc",
          creatorName: "Dunc",
          sourceMode: "riftbound",
          playlistId: "",
          succeeded: true,
          error: "",
          items: [{
            videoId: "filtered001",
            title: "Other game update",
            url: "https://www.youtube.com/watch?v=filtered001",
            embedUrl: "https://www.youtube-nocookie.com/embed/filtered001",
            thumbnailUrl: "https://i.ytimg.com/vi/filtered001/hqdefault.jpg",
            creatorId: "dunc",
            creatorName: "Dunc",
            channelUrl: "https://www.youtube.com/@dunctcg",
            publishedAt: "2026-08-04T09:00:00.000Z",
            status: "filtered",
            reason: "No Riftbound terms found",
          }],
        }],
      }))
      .mockImplementationOnce(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({ config: body.config });
      });
    const view = render(createElement(CreatorVideoCarouselPanel, { onClose: vi.fn() }));

    await waitFor(() => expect(view.getByRole("button", {
      name: "Always include Other game update",
    })).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: "Always include Other game update" }));

    expect(view.getByLabelText("Always include YouTube video IDs"))
      .toHaveValue("filtered001");
    expect(view.getByRole("button", { name: "Hide Other game update" })).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Save carousel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const saved = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      config: CreatorVideoCarouselConfig;
    };
    expect(saved.config.includedVideoIds).toEqual(["filtered001"]);
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
      expect(view.getByText(/settings and feed preview refreshed/i)).toBeInTheDocument();
    });
    fireEvent.click(view.getByRole("button", { name: "Close creator video carousel settings" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Meta Studio live takeover panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => cleanup());

  it("arms and ends the desktop takeover without accepting a player URL", async () => {
    const initialConfig: LiveTakeoverConfig = {
      enabled: false,
      provider: "twitch",
      channelLogin: "bmucasts",
      title: "BMU Casts is live",
    };
    const responses = (config: LiveTakeoverConfig) => ({
      config,
      liveTakeover: {
        ...config,
        active: config.enabled,
        status: config.enabled ? "live" : "disabled",
        channelUrl: `https://www.twitch.tv/${config.channelLogin}`,
        updatedAt: 1234,
      },
      streamStatus: {
        state: config.enabled ? "live" : "offline",
        isLive: config.enabled,
        tooltip: `${config.channelLogin} is ${config.enabled ? "live" : "offline"} on Twitch`,
        channelLogin: config.channelLogin,
        channelUrl: `https://www.twitch.tv/${config.channelLogin}`,
      },
      message: config.enabled
        ? "Live takeover is on and Twitch confirms the channel is live."
        : "Live takeover ended. Desktop Home will return to the video carousel.",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(responses(initialConfig)))
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          config: LiveTakeoverConfig;
        };
        return jsonResponse(responses({
          ...body.config,
          channelLogin: body.config.channelLogin.trim().toLowerCase(),
          title: body.config.title.trim(),
        }));
      });
    const view = render(createElement(LiveTakeoverPanel, { onClose: vi.fn() }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Live stream takeover" })).toBeInTheDocument();
      expect(view.getByText("Takeover off")).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Go live on RiftLite" })).toBeInTheDocument();
    });

    fireEvent.change(view.getByLabelText("Twitch channel login"), {
      target: { value: "BMUCasts" },
    });
    fireEvent.change(view.getByLabelText("Live takeover title"), {
      target: { value: " Sunday Riftbound live " },
    });
    fireEvent.click(view.getByRole("button", { name: "Go live on RiftLite" }));

    await waitFor(() => {
      expect(view.getByText("Live on RiftLite")).toBeInTheDocument();
      expect(view.getByRole("button", { name: "End takeover" })).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/meta-studio/live-takeover");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
    const armed = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      config: LiveTakeoverConfig & { embedUrl?: string };
    };
    expect(armed.config).toEqual({
      enabled: true,
      provider: "twitch",
      channelLogin: "BMUCasts",
      title: " Sunday Riftbound live ",
    });
    expect(armed.config).not.toHaveProperty("embedUrl");

    fireEvent.click(view.getByRole("button", { name: "End takeover" }));
    await waitFor(() => expect(view.getByText("Takeover off")).toBeInTheDocument());
    const ended = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      config: LiveTakeoverConfig;
    };
    expect(ended.config.enabled).toBe(false);
  });
});
