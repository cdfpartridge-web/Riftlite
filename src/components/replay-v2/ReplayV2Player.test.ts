import { createElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import Router from "next/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  projectReplayState,
  type CanonicalReplayV2,
} from "@/lib/replay-v2";

vi.mock("firebase/auth", () => ({
  getAuth: () => ({ authStateReady: async () => undefined, currentUser: null }),
}));

vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import {
  ReplayV2Player,
  replayCardMotionLayoutSignature,
  replayGamePlaybackStartMs,
} from "./ReplayV2Player";
import { replayNotesStorageKey } from "./replay-notes";
import {
  SHARED_REPLAY_NOTES_HASH_PARAM,
  decodeSharedReplayNotesPayload,
  encodeSharedReplayNotesPayload,
} from "./replay-notes-url";

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

if (!HTMLElement.prototype.animate) {
  HTMLElement.prototype.animate = () => ({ pause() {}, play() {} } as Animation);
}

describe("ReplayV2Player presentation prelude", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay: sideboardingAtZeroReplay() }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens paused on Matchup even when sideboarding is the last canonical event at zero", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();
    expect(view.queryByText("Sideboarding")).not.toBeInTheDocument();
  });

  it("creates a precise clip link from the top-right replay control", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
    const writeText = vi.fn(async () => undefined);
    window.history.replaceState({}, "", "/replays/rp_clip?t=12");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Reflect.deleteProperty(navigator, "share");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Harnessed Dragon" }));
      expect(view.container.querySelector("[data-card-inspector]"))
        .toHaveTextContent("Harnessed Dragon");
      fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-control="speed"]')!);
      expect(view.getByRole("status")).toHaveTextContent("2× playback");
      fireEvent.click(await view.findByRole("button", { name: "Clip replay" }));
      const dialog = view.getByRole("dialog", { name: "Create replay clip" });
      expect(dialog).toHaveTextContent("0:12");
      expect(view.queryByText("2× playback")).not.toBeInTheDocument();
      const startSlider = view.getByRole("slider", { name: "Clip start" });
      expect(startSlider).toHaveFocus();
      expect(startSlider).toHaveAttribute("aria-valuetext", "0:12.000");
      expect(view.getByRole("textbox", {
        name: "Clip start time in minutes and seconds",
      })).toHaveValue("0:12.000");
      expect(view.container.querySelector("[inert]")).toBeInTheDocument();
      expect(view.container.querySelector('[data-control="clip"]'))
        .toHaveAttribute("aria-expanded", "true");
      let copyButton = view.getByRole("button", { name: "Copy clip link" });
      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: "Tab" });
      expect(view.getByRole("button", { name: "Close replay clip editor" })).toHaveFocus();

      fireEvent.click(view.getByRole("button", {
        name: "Mark current frame as clip start and return to replay, 0:12.000",
      }));
      expect(view.queryByRole("dialog")).not.toBeInTheDocument();
      expect(window.location.search).toBe("?t=12");
      expect(view.getByRole("button", { name: /Finish replay clip/ }))
        .toHaveAccessibleName("Finish replay clip — start marked at 0:12.000");
      expect(view.getByRole("slider", { name: "Clip start marker, 0:12.000" }))
        .toHaveValue("12000");
      expect(view.container.querySelector("[data-clip-start-chip]"))
        .toHaveTextContent("Clip start · 0:12.000");

      const timeline = view.getByRole("slider", { name: "Replay progress" });
      fireEvent.change(timeline, { target: { value: "45550" } });
      await waitFor(() => expect(timeline).toHaveValue("45550"));
      fireEvent.click(view.getByRole("button", { name: /Finish replay clip/ }));

      expect(view.getByRole("dialog", { name: "Set clip end" })).toHaveTextContent(
        "Start remembered at 0:12.000",
      );
      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("12000");
      expect(view.getByRole("slider", { name: "Clip end" })).toHaveValue("45550");
      expect(view.getByRole("button", {
        name: "Use current frame as clip end, 0:45.550",
      })).toHaveFocus();
      fireEvent.click(view.getByRole("button", {
        name: "Move clip end back 0.1 seconds",
      }));
      expect(view.getByRole("slider", { name: "Clip end" })).toHaveValue("45450");
      fireEvent.click(view.getByRole("button", {
        name: "Move clip end forward 0.1 seconds",
      }));
      fireEvent.click(view.getByRole("button", {
        name: "Use current frame as clip end, 0:45.550",
      }));
      expect(view.getByRole("dialog", { name: "Review draft clip" })).toBeInTheDocument();
      expect(view.getByRole("button", {
        name: "Use current frame as clip end, 0:45.550",
      })).toHaveFocus();
      expect(window.location.search).toBe("?t=12");
      expect(view.getByRole("dialog", { name: "Review draft clip" })).toHaveTextContent(
        "Start 0:12.000 and end 0:45.550 are remembered",
      );
      copyButton = view.getByRole("button", { name: "Copy clip link" });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(
          `${window.location.origin}/replays/rp_clip?start=12&end=45.55`,
        );
      });
      expect(view.getByRole("dialog", { name: "Review draft clip" })).toBeInTheDocument();
      expect(view.container.querySelector('[data-replay-clip="true"]')).not.toBeInTheDocument();
      expect(timeline).toHaveAttribute("min", "0");
      expect(timeline).toHaveAttribute("max", "120000");
      expect(timeline).toHaveValue("45550");
      expect(window.location.search).toBe("?t=12");
      expect(view.getByRole("status")).toHaveTextContent(
        "Clip link copied — this replay is unchanged",
      );

      fireEvent.click(view.getByRole("button", { name: "Close replay clip editor" }));
      expect(view.getByRole("slider", { name: "Clip start marker, 0:12.000" }))
        .toHaveValue("12000");
      expect(view.getByRole("slider", { name: "Clip end marker, 0:45.550" }))
        .toHaveValue("45550");
      expect(view.container.querySelector("[data-clip-start-chip]"))
        .toHaveTextContent("Draft clip · 0:12.000 → 0:45.550");

      fireEvent.click(view.getByRole("button", { name: "Share replay" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
      expect(writeText).toHaveBeenLastCalledWith(
        `${window.location.origin}/replays/rp_clip?t=46`,
      );

      fireEvent.click(view.getByRole("button", { name: /Review draft replay clip/ }));
      fireEvent.click(view.getByRole("button", { name: "Preview clip" }));
      expect(view.container.querySelector('[data-replay-clip="true"]')).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Edit replay clip" }))
        .toHaveAttribute("data-active", "true");
      expect(view.getByRole("slider", { name: "Replay progress" })).toHaveAttribute("min", "12000");
      expect(view.getByRole("slider", { name: "Replay progress" })).toHaveAttribute("max", "45550");
      expect(window.location.search).toBe("?start=12&end=45.55");

      fireEvent.click(view.getByRole("button", { name: "More" }));
      const morePanel = view.container.querySelector<HTMLElement>('[data-control="more-panel"]');
      expect(morePanel).toHaveTextContent(
        "Full-replay frame, game, and turn controls are hidden for shared clips.",
      );
      expect(morePanel?.querySelector('[data-control="frame-navigator"]')).not.toBeInTheDocument();
      expect(morePanel?.querySelector('[aria-label="Previous game"]')).not.toBeInTheDocument();
      expect(morePanel?.querySelector('[aria-label="Next turn"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (shareDescriptor) Object.defineProperty(navigator, "share", shareDescriptor);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  it("edits clip endpoints as minutes and seconds without snapping partial input", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn(async (value: string) => {
      void value;
    });
    window.history.replaceState({}, "", "/replays/rp_clip_clock?t=12");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(180_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_clock" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Clip replay" }));
      let timeInput = view.getByRole("textbox", {
        name: "Clip start time in minutes and seconds",
      });
      const startSlider = view.getByRole("slider", { name: "Clip start" });
      expect(timeInput).toHaveValue("0:12.000");

      fireEvent.change(timeInput, { target: { value: "1:" } });
      expect(timeInput).toHaveValue("1:");
      fireEvent.change(timeInput, { target: { value: "1:05.250" } });
      fireEvent.keyDown(timeInput, { key: "Enter" });
      expect(startSlider).toHaveValue("65250");
      timeInput = view.getByRole("textbox", {
        name: "Clip start time in minutes and seconds",
      });
      expect(timeInput).toHaveValue("1:05.250");

      fireEvent.change(timeInput, { target: { value: "1:75" } });
      fireEvent.blur(timeInput);
      expect(timeInput).toHaveAttribute("aria-invalid", "true");
      expect(timeInput).toHaveValue("1:75");
      expect(startSlider).toHaveValue("65250");
      expect(view.getByRole("button", { name: "Preview clip" })).toBeDisabled();
      expect(view.getByRole("button", { name: "Copy clip link" })).toBeDisabled();
      fireEvent.click(view.getByRole("button", { name: "Copy clip link" }));
      expect(writeText).not.toHaveBeenCalled();
      fireEvent.keyDown(timeInput, { key: "Escape" });
      expect(timeInput).toHaveValue("1:05.250");

      fireEvent.change(timeInput, { target: { value: "0:20.125" } });
      fireEvent.click(view.getByRole("button", { name: "Copy clip link" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/replays/rp_clip_clock?start=20.125&end=65.3`,
      ));

      fireEvent.change(startSlider, { target: { value: "70000" } });
      timeInput = view.getByRole("textbox", {
        name: "Clip start time in minutes and seconds",
      });
      expect(timeInput).toHaveValue("1:10.000");
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("keeps a marked clip start when the playhead moves earlier", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/replays/rp_clip_mark?t=40");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_mark" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Clip replay" }));
      fireEvent.click(view.getByRole("button", {
        name: "Mark current frame as clip start and return to replay, 0:40.000",
      }));

      const timeline = view.getByRole("slider", { name: "Replay progress" });
      fireEvent.change(timeline, { target: { value: "20000" } });
      await waitFor(() => expect(timeline).toHaveValue("20000"));
      fireEvent.click(view.getByRole("button", { name: /Finish replay clip/ }));

      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("40000");
      expect(view.getByRole("slider", { name: "Clip end" })).toHaveValue("70000");
      expect(view.getByRole("button", {
        name: "Use current frame as clip end, 0:20.000",
      })).toBeDisabled();
      expect(view.getByText(/Move after 0:40.050/)).toBeInTheDocument();
      expect(view.getByRole("slider", { name: "Clip end" })).toHaveFocus();

      fireEvent.click(view.getByRole("button", {
        name: "Move clip start forward 0.1 seconds",
      }));
      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("40100");
      expect(view.getByText(/Start remembered at 0:40.000/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Close replay clip editor" }));
      expect(view.getByRole("button", { name: /Finish replay clip/ }))
        .toHaveAccessibleName("Finish replay clip — start marked at 0:40.000");
      fireEvent.click(view.getByRole("button", { name: /Finish replay clip/ }));
      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("40000");

      fireEvent.click(view.getByRole("button", { name: "Clear clip markers" }));
      expect(view.getByRole("dialog", { name: "Create replay clip" })).toBeInTheDocument();
      expect(view.queryByText("Start remembered at 0:40.000")).not.toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Close replay clip editor" }));
      expect(view.getByRole("button", { name: "Clip replay" })).toBeInTheDocument();
      expect(view.container.querySelector("[data-clip-start-marker]"))
        .not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("remembers a marked clip end and lets both draft markers be dragged on the timeline", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/replays/rp_clip_drag?t=10.5");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_drag" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Clip replay" }));
      fireEvent.click(view.getByRole("button", {
        name: "Mark current frame as clip start and return to replay, 0:10.500",
      }));

      const timeline = view.getByRole("slider", { name: "Replay progress" });
      fireEvent.change(timeline, { target: { value: "30250" } });
      await waitFor(() => expect(timeline).toHaveValue("30250"));
      fireEvent.click(view.getByRole("button", { name: /Finish replay clip/ }));
      fireEvent.click(view.getByRole("button", {
        name: "Use current frame as clip end, 0:30.250",
      }));

      expect(view.getByRole("dialog", { name: "Review draft clip" })).toBeInTheDocument();
      expect(window.location.search).toBe("?t=10.5");
      fireEvent.click(view.getByRole("button", { name: "Close replay clip editor" }));
      let startMarker = view.getByRole("slider", {
        name: "Clip start marker, 0:10.500",
      });
      let endMarker = view.getByRole("slider", {
        name: "Clip end marker, 0:30.250",
      });
      expect(startMarker).toHaveAttribute("max", "120000");
      expect(endMarker).toHaveAttribute("min", "0");

      fireEvent.change(startMarker, { target: { value: "12550" } });
      await waitFor(() => expect(timeline).toHaveValue("12550"));
      startMarker = view.getByRole("slider", {
        name: "Clip start marker, 0:12.550",
      });
      expect(startMarker).toHaveValue("12550");

      fireEvent.change(endMarker, { target: { value: "28250" } });
      await waitFor(() => expect(timeline).toHaveValue("28250"));
      endMarker = view.getByRole("slider", {
        name: "Clip end marker, 0:28.250",
      });
      expect(endMarker).toHaveValue("28250");
      expect(window.location.search).toBe("?t=10.5");

      fireEvent.change(startMarker, { target: { value: "99999" } });
      await waitFor(() => expect(timeline).toHaveValue("28200"));
      startMarker = view.getByRole("slider", {
        name: "Clip start marker, 0:28.200",
      });
      endMarker = view.getByRole("slider", {
        name: "Clip end marker, 0:28.250",
      });
      expect(startMarker).toHaveValue("28200");

      fireEvent.change(endMarker, { target: { value: "0" } });
      await waitFor(() => expect(timeline).toHaveValue("28250"));
      expect(view.getByRole("slider", {
        name: "Clip end marker, 0:28.250",
      })).toHaveValue("28250");

      fireEvent.click(view.getByRole("button", { name: /Review draft replay clip/ }));
      expect(view.getByRole("dialog", { name: "Review draft clip" })).toBeInTheDocument();
      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("28200");
      expect(view.getByRole("slider", { name: "Clip end" })).toHaveValue("28250");
      expect(window.location.search).toBe("?t=10.5");
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("adds, selects, and drags an exact timestamped replay note in place of card details", async () => {
    const replayId = "rp_replay_notes";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const storageKey = replayNotesStorageKey(replayId);
    window.localStorage.removeItem(storageKey);
    window.history.replaceState({}, "", `/replays/${replayId}?t=12.345`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Harnessed Dragon" }));
      expect(view.container.querySelector("[data-card-inspector]"))
        .toHaveTextContent("Harnessed Dragon");

      fireEvent.click(view.getByRole("button", {
        name: "Add replay note at 0:12.345",
      }));
      expect(view.container.querySelector("[data-replay-note-editor]"))
        .toHaveTextContent("0:12.345");
      fireEvent.change(view.getByRole("textbox", { name: "Replay note title" }), {
        target: { value: "Lethal check" },
      });
      fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), {
        target: { value: "Count available runes before committing." },
      });
      fireEvent.click(view.getByRole("button", {
        name: "Add replay note at 0:12.345",
      }));
      expect(view.getByRole("textbox", { name: "Replay note" }))
        .toHaveValue("Count available runes before committing.");
      expect(view.getByText("Save or cancel the open note first")).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Save note" }));

      await waitFor(() => {
        expect(view.container.querySelector("[data-replay-note-inspector]"))
          .toHaveTextContent("Lethal check");
      });
      expect(view.container.querySelector("[data-card-inspector]"))
        .not.toBeInTheDocument();
      expect(view.container.querySelector("[data-replay-note-inspector]"))
        .toHaveTextContent("Count available runes before committing.");
      const noteListItem = view.getByRole("button", {
        name: /0:12\.345 Lethal check Count available runes before committing\./,
      });
      expect(noteListItem).toHaveAttribute("aria-current", "true");
      expect(view.getByRole("slider", {
        name: "Replay note 1, Lethal check, 0:12.345",
      })).toHaveValue("12345");

      fireEvent.click(view.getByRole("button", { name: "Back to card details" }));
      expect(view.container.querySelector("[data-replay-note-inspector]"))
        .not.toBeInTheDocument();
      expect(view.container.querySelector("[data-card-inspector]"))
        .toHaveTextContent("Harnessed Dragon");

      const timeline = view.getByRole("slider", { name: "Replay progress" });
      fireEvent.change(timeline, { target: { value: "45000" } });
      await waitFor(() => expect(timeline).toHaveValue("45000"));
      fireEvent.click(noteListItem);
      await waitFor(() => expect(timeline).toHaveValue("12345"));
      expect(noteListItem).toHaveAttribute("aria-current", "true");
      expect(view.container.querySelector("[data-replay-note-inspector]"))
        .toHaveTextContent("Lethal check");
      expect(view.container.querySelector("[data-card-inspector]"))
        .not.toBeInTheDocument();

      const noteMarker = view.getByRole("slider", {
        name: "Replay note 1, Lethal check, 0:12.345",
      });
      fireEvent.change(noteMarker, { target: { value: "15550" } });
      fireEvent.pointerUp(noteMarker, { target: { value: "15550" } });
      await waitFor(() => expect(timeline).toHaveValue("15550"));
      expect(view.getByRole("slider", {
        name: "Replay note 1, Lethal check, 0:15.550",
      })).toHaveValue("15550");
      expect(view.container.querySelector("[data-replay-note-inspector]"))
        .toHaveTextContent("0:15.550");
      expect(window.location.search).toBe("?t=12.345");
      expect(window.localStorage.getItem(storageKey)).toContain('"atMs":15550');
    } finally {
      view.unmount();
      window.localStorage.removeItem(storageKey);
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("copies an explicit clip link with notes and opens them read-only in another browser", async () => {
    const replayId = "rp_shared_replay_notes";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const storageKey = replayNotesStorageKey(replayId);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
    const writeText = vi.fn(async (value: string) => {
      void value;
    });
    window.localStorage.removeItem(storageKey);
    window.history.replaceState({}, "", `/replays/${replayId}?start=10&end=20`);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Reflect.deleteProperty(navigator, "share");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    let view = render(createElement(ReplayV2Player, { replayId }));

    try {
      fireEvent.click(await view.findByRole("button", {
        name: "Add replay note at 0:10.000",
      }));
      fireEvent.change(view.getByRole("textbox", { name: "Replay note title" }), {
        target: { value: "Lethal check" },
      });
      fireEvent.change(view.getByRole("textbox", { name: "Replay note" }), {
        target: { value: "Count the open runes before attacking." },
      });
      fireEvent.click(view.getByRole("button", { name: "Save note" }));

      expect(view.getByText(
        "Sharing puts every note shown here into the link. Anyone with that link can read them.",
      )).toBeVisible();
      fireEvent.click(await view.findByRole("button", { name: "Copy link with 1 note" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const notesLink = String(writeText.mock.calls[0]?.[0]);
      const notesUrl = new URL(notesLink);
      expect(notesUrl.search).toBe("?start=10&end=20");
      const payload = new URLSearchParams(notesUrl.hash.slice(1))
        .get(SHARED_REPLAY_NOTES_HASH_PARAM);
      expect(payload).toBeTruthy();
      expect(decodeSharedReplayNotesPayload(payload!, replayId)).toEqual([{
        atMs: 10_000,
        title: "Lethal check",
        body: "Count the open runes before attacking.",
      }]);
      expect(window.location.hash).toBe("");

      fireEvent.click(view.getByRole("button", { name: "Share replay" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
      expect(writeText).toHaveBeenLastCalledWith(
        `${window.location.origin}/replays/${replayId}?start=10&end=20`,
      );

      view.unmount();
      window.localStorage.removeItem(storageKey);
      window.history.replaceState({}, "", notesLink);
      view = render(createElement(ReplayV2Player, { replayId }));

      expect(await view.findByText("Shared notes", { selector: "b" })).toBeInTheDocument();
      expect(view.container.querySelector("[data-shared-replay-notes]"))
        .toHaveTextContent("View-only notes carried by this link");
      expect(window.localStorage.getItem(storageKey)).toBeNull();
      expect(view.queryByRole("button", { name: /Add replay note at/ })).not.toBeInTheDocument();
      expect(await view.findByRole("button", {
        name: "Shared replay note 1, Lethal check, 0:10.000",
      })).toBeInTheDocument();

      fireEvent.click(view.getByRole("button", {
        name: /0:10\.000 Lethal check.*Count the open runes before attacking\./,
      }));
      const inspector = view.container.querySelector("[data-replay-note-inspector]");
      expect(inspector).toHaveAttribute("data-shared-note", "true");
      expect(inspector).toHaveTextContent("Shared replay note");
      expect(view.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(view.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

      fireEvent.click(view.getByRole("button", { name: "Save a copy" }));
      await waitFor(() => expect(window.location.hash).toBe(""));
      expect(window.location.search).toBe("?start=10&end=20");
      expect(window.localStorage.getItem(storageKey)).toContain("Lethal check");
      expect(view.getByRole("button", { name: /Add replay note at/ })).toBeInTheDocument();
      await waitFor(() => expect(view.getByRole("tab", { name: /Notes 1/ })).toHaveFocus());
    } finally {
      view.unmount();
      window.localStorage.removeItem(storageKey);
      window.history.replaceState({}, "", previousUrl || "/");
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
      if (shareDescriptor) Object.defineProperty(navigator, "share", shareDescriptor);
      else Reflect.deleteProperty(navigator, "share");
    }
  });

  it("keeps the replay position and open clip draft when only the shared-notes hash changes", async () => {
    const replayId = "rp_shared_hash_navigation";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const payload = encodeSharedReplayNotesPayload(replayId, [{
      atMs: 12_000,
      title: "Coach note",
      body: "Review this decision.",
    }]);
    expect(payload).toBeTruthy();
    window.history.replaceState({}, "", `/replays/${replayId}?t=12`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId }));

    try {
      const timeline = await view.findByRole("slider", { name: "Replay progress" });
      fireEvent.click(view.getByRole("button", { name: "Clip replay" }));
      const startSlider = view.getByRole("slider", { name: "Clip start" });
      fireEvent.change(startSlider, { target: { value: "15000" } });
      expect(startSlider).toHaveValue("15000");

      act(() => {
        const oldURL = window.location.href;
        window.history.pushState(
          {},
          "",
          `/replays/${replayId}?t=12#${SHARED_REPLAY_NOTES_HASH_PARAM}=${payload}`,
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.dispatchEvent(new HashChangeEvent("hashchange", {
          oldURL,
          newURL: window.location.href,
        }));
      });

      expect(await view.findByText("Shared notes", { selector: "b" })).toBeInTheDocument();
      expect(view.getByRole("dialog", { name: "Create replay clip" })).toBeInTheDocument();
      expect(view.getByRole("slider", { name: "Clip start" })).toHaveValue("15000");
      expect(timeline).toHaveValue("12000");
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("re-encodes shared notes inside newly previewed clip bounds so the URL survives refresh", async () => {
    const replayId = "rp_shared_notes_clip_edit";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nearNote = { atMs: 10_000, title: "Inside", body: "Keep this note." };
    const farNote = { atMs: 80_000, title: "Outside", body: "Do not carry this into the clip." };
    const payload = encodeSharedReplayNotesPayload(replayId, [nearNote, farNote]);
    expect(payload).toBeTruthy();
    window.history.replaceState(
      {},
      "",
      `/replays/${replayId}#${SHARED_REPLAY_NOTES_HASH_PARAM}=${payload}`,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    let view = render(createElement(ReplayV2Player, { replayId }));

    try {
      expect(await view.findByText("Shared notes", { selector: "b" })).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Clip replay" }));
      fireEvent.change(view.getByRole("slider", { name: "Clip start" }), {
        target: { value: "5000" },
      });
      fireEvent.change(view.getByRole("slider", { name: "Clip end" }), {
        target: { value: "20000" },
      });
      fireEvent.click(view.getByRole("button", { name: "Preview clip" }));

      expect(window.location.search).toBe("?start=5&end=20");
      const nextPayload = new URLSearchParams(window.location.hash.slice(1))
        .get(SHARED_REPLAY_NOTES_HASH_PARAM);
      expect(decodeSharedReplayNotesPayload(nextPayload ?? "", replayId)).toEqual([nearNote]);

      view.unmount();
      view = render(createElement(ReplayV2Player, { replayId }));
      expect(await view.findByText("Shared notes", { selector: "b" })).toBeInTheDocument();
      expect(view.getByText("Inside")).toBeInTheDocument();
      expect(view.queryByText("Outside")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("keeps a shared-notes link open instead of partially importing past local capacity", async () => {
    const replayId = "rp_shared_notes_capacity";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const storageKey = replayNotesStorageKey(replayId);
    const storedProject = JSON.stringify({
      version: 1,
      replayId,
      notes: Array.from({ length: 249 }, (_, index) => ({
        id: `local-${index}`,
        atMs: index,
        eventId: "",
        eventIndex: -1,
        gameId: "",
        gameNumber: null,
        turn: null,
        title: `Local ${index}`,
        body: "",
        createdAt: index,
        updatedAt: index,
      })),
      updatedAt: 248,
    });
    window.localStorage.setItem(storageKey, storedProject);
    const payload = encodeSharedReplayNotesPayload(replayId, [
      { atMs: 10_000, title: "New one", body: "First new note." },
      { atMs: 11_000, title: "New two", body: "Second new note." },
    ]);
    expect(payload).toBeTruthy();
    window.history.replaceState(
      {},
      "",
      `/replays/${replayId}#${SHARED_REPLAY_NOTES_HASH_PARAM}=${payload}`,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId }));

    try {
      expect(await view.findByText("Shared notes", { selector: "b" })).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Save a copy" }));
      expect(await view.findByText(/Not enough note space:/)).toBeInTheDocument();
      expect(window.location.hash).toContain(`${SHARED_REPLAY_NOTES_HASH_PARAM}=`);
      expect(window.localStorage.getItem(storageKey)).toBe(storedProject);
      expect(view.container.querySelector("[data-shared-replay-notes]")).toBeInTheDocument();
    } finally {
      view.unmount();
      window.localStorage.removeItem(storageKey);
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("rejects and dismisses an invalid shared-notes fragment without touching local notes", async () => {
    const replayId = "rp_bad_shared_notes";
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const storageKey = replayNotesStorageKey(replayId);
    window.localStorage.removeItem(storageKey);
    window.history.replaceState({}, "", `/replays/${replayId}?t=12#${SHARED_REPLAY_NOTES_HASH_PARAM}=bad`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId }));

    try {
      expect(await view.findByText("Notes link unavailable", { selector: "b" }))
        .toBeInTheDocument();
      expect(window.localStorage.getItem(storageKey)).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
      expect(window.location.hash).toBe("");
      expect(window.location.search).toBe("?t=12");
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    } finally {
      view.unmount();
      window.localStorage.removeItem(storageKey);
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("updates clip bounds when browser history changes the same replay URL", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/replays/rp_clip_history?start=10&end=20");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(120_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_history" }));

    try {
      const timeline = await view.findByRole("slider", { name: "Replay progress" });
      expect(timeline).toHaveAttribute("min", "10000");
      expect(timeline).toHaveAttribute("max", "20000");
      const clipTrigger = view.getByRole("button", { name: "Edit replay clip" });
      clipTrigger.focus();
      fireEvent.click(clipTrigger);
      expect(view.getByRole("dialog", { name: "Edit replay clip" })).toBeInTheDocument();

      act(() => {
        window.history.pushState({}, "", "/replays/rp_clip_history?start=30&end=45.5");
        Router.events.emit(
          "routeChangeComplete",
          "/replays/rp_clip_history?start=30&end=45.5",
          { shallow: true },
        );
      });
      await waitFor(() => {
        expect(timeline).toHaveAttribute("min", "30000");
        expect(timeline).toHaveAttribute("max", "45500");
        expect(timeline).toHaveValue("30000");
        expect(clipTrigger).toHaveFocus();
      });

      act(() => {
        window.history.pushState({}, "", "/replays/rp_clip_history?t=35");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await waitFor(() => {
        expect(timeline).toHaveAttribute("min", "0");
        expect(timeline).toHaveAttribute("max", "120000");
        expect(timeline).toHaveValue("35000");
      });
      expect(view.container.querySelector('[data-replay-clip="true"]')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("plays a shared zero-start clip only to its end, then replays from its start", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    window.history.replaceState({}, "", "/replays/rp_clip_zero?start=0&end=0.1");
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((requestedFrameId: number) => {
      queuedFrames.delete(requestedFrameId);
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: replayWithDuration(1_000),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_zero" }));

    try {
      const timeline = await view.findByRole("slider", { name: "Replay progress" });
      expect(timeline).toHaveAttribute("min", "0");
      expect(timeline).toHaveAttribute("max", "100");
      expect(timeline).toHaveValue("0");
      expect(view.container.querySelector('[data-scene="matchup"]')).not.toBeInTheDocument();
      expect(view.getByRole("button", { name: "Clip beginning" })).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Clip end" })).toBeInTheDocument();

      queuedFrames.clear();
      fireEvent.click(view.getByRole("button", { name: "Play replay" }));
      await waitFor(() => expect(view.getByRole("button", { name: "Pause replay" })).toBeInTheDocument());
      act(() => {
        const now = performance.now() + 250;
        for (const [queuedFrameId, callback] of [...queuedFrames]) {
          queuedFrames.delete(queuedFrameId);
          callback(now);
        }
      });

      await waitFor(() => expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument());
      expect(timeline).toHaveValue("100");

      fireEvent.click(view.getByRole("button", { name: "Play replay" }));
      await waitFor(() => expect(timeline).toHaveValue("0"));
      expect(view.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("shows clipboard failures inside the open clip editor", async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("blocked"))) },
    });
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_blocked" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "Clip replay" }));
      fireEvent.click(view.getByRole("button", { name: "Copy clip link" }));
      await waitFor(() => {
        expect(view.getByRole("status"))
          .toHaveTextContent("The browser blocked clip link copying");
      });
      expect(view.getByRole("dialog", { name: "Create replay clip" })).toBeInTheDocument();
    } finally {
      view.unmount();
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("does not offer a broken public clip link for a custom local replay endpoint", async () => {
    const view = render(createElement(ReplayV2Player, {
      apiBasePath: "/api/local/tcga-replays",
      replayId: "local_fixture",
    }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-replay-player="v2"]')).toBeInTheDocument();
    });
    expect(view.queryByRole("button", { name: "Clip replay" })).not.toBeInTheDocument();
  });

  it("offers display-only player name hiding only in an explicitly authorized private workspace", async () => {
    const normalView = render(createElement(ReplayV2Player, { replayId: "rp_normal_names" }));
    await waitFor(() => expect(normalView.container.querySelector('[data-replay-player="v2"]')).toBeInTheDocument());
    expect(normalView.queryByRole("button", { name: "Hide player names" })).not.toBeInTheDocument();
    normalView.unmount();

    const studioView = render(createElement(ReplayV2Player, { allowPlayerNameHiding: true, replayId: "rp_studio_names" }));
    const hideButton = await studioView.findByRole("button", { name: "Hide player names" });
    expect(studioView.getByRole("heading", { name: "LeBlanc" })).toBeInTheDocument();
    expect(studioView.getByRole("heading", { name: "Fiora" })).toBeInTheDocument();

    fireEvent.click(hideButton);

    expect(studioView.getByRole("button", { name: "Show player names" })).toHaveAttribute("aria-pressed", "true");
    expect(studioView.getByRole("heading", { name: "Player 1" })).toBeInTheDocument();
    expect(studioView.getByRole("heading", { name: "Player 2" })).toBeInTheDocument();
  });

  it("keeps the opponent hand hidden in a normal perspective replay", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_private_hand" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-player-id="opponent"] [data-hand-cards]'))
        .toBeInTheDocument();
    });
    const opponentHand = view.container.querySelector<HTMLElement>(
      '[data-player-id="opponent"] [data-hand-cards]',
    );
    expect(opponentHand?.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Hidden card");
    expect(opponentHand?.querySelector("[data-card-code]")).not.toBeInTheDocument();
    expect(view.container.querySelector("[data-combined-replay]")).not.toBeInTheDocument();
  });

  it("reveals only opponent cards proven by the later timeline when Cards up is enabled", async () => {
    const replay = futureKnownAnalysisReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");
    snapshot.snapshot.players.opponent.zones.hand.push(hiddenCard("opponent-unknown"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_cards_up" }));

    const toggle = await view.findByRole("button", { name: "Cards up" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Hidden card");
    expect(view.container.querySelector('[data-card-id="opponent-unknown"]'))
      .toHaveAccessibleName("Hidden card");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Eager Apprentice, known from a later reveal");
    });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAttribute("data-analysis-card", "future-known");
    expect(view.container.querySelector('[data-card-id="opponent-unknown"]'))
      .toHaveAccessibleName("Hidden card");
    expect(view.container.querySelector('[data-cards-up-badge="known-only"]'))
      .toHaveTextContent("Cards up · 1 known card");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(view.container.querySelector("[data-cards-up-badge]")).not.toBeInTheDocument();
  });

  it("does not use card knowledge from after a shared clip ends", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/replays/rp_clip_knowledge?start=0&end=0.5");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: futureKnownAnalysisReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_clip_knowledge" }));

    try {
      const cardsUpToggle = await view.findByRole("button", { name: "Cards up" });
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");

      fireEvent.click(cardsUpToggle);
      await waitFor(() => expect(cardsUpToggle).toHaveAttribute("aria-pressed", "true"));
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");

      fireEvent.click(view.getByRole("button", { name: "Take control" }));
      await waitFor(() => {
        expect(view.container.querySelector("[data-analysis-panel]")).toBeInTheDocument();
      });
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");
      expect(view.queryByText(/known from a later reveal/i)).not.toBeInTheDocument();
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("keeps a returned public card visible without exposing unrelated private hand data", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/?t=1");
    const replay = previouslyKnownCardsUpReplay();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_cards_up_returned" }));

    try {
      const toggle = await view.findByRole("button", { name: "Cards up" });
      expect(view.container.querySelector('[data-card-id="opponent-returned"]'))
        .toHaveAccessibleName("Hidden card");
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(view.container.querySelector('[data-card-id="opponent-returned"]'))
          .toHaveAccessibleName("Stupefy, known from an earlier reveal");
      });
      expect(view.container.querySelector('[data-card-id="opponent-returned"]'))
        .toHaveAttribute("data-analysis-card", "previously-known");
      expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
        .toHaveAccessibleName("Hidden card");
      expect(view.container.querySelector('[data-cards-up-badge="known-only"]'))
        .toHaveTextContent("Cards up · 1 known card");
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("offers labelled player fullscreen controls and keeps F and Escape in sync", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_fullscreen" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-replay-player="v2"]')).toBeInTheDocument();
    });
    const shell = view.container.querySelector<HTMLElement>('[data-replay-player="v2"]')!;
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = shell;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(shell, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });

    try {
      fireEvent.click(view.getByRole("button", { name: "Full screen" }));
      await waitFor(() => expect(shell).toHaveAttribute("data-fullscreen", "true"));
      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(view.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
      expect(view.getByRole("button", { name: "Exit player fullscreen" })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(shell).not.toHaveAttribute("data-fullscreen"));
      expect(exitFullscreen).toHaveBeenCalledOnce();

      fireEvent.keyDown(window, { key: "f" });
      await waitFor(() => expect(shell).toHaveAttribute("data-fullscreen", "true"));
      expect(requestFullscreen).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      Reflect.deleteProperty(shell, "requestFullscreen");
      if (fullscreenDescriptor) Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
      else Reflect.deleteProperty(document, "fullscreenElement");
      if (exitDescriptor) Object.defineProperty(document, "exitFullscreen", exitDescriptor);
      else Reflect.deleteProperty(document, "exitFullscreen");
    }
  });

  it("creates a temporary analysis branch with conservative future-hand knowledge", async () => {
    const replay = futureKnownAnalysisReplay();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_analysis" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-control="analysis"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Hidden card");

    fireEvent.click(view.getByRole("button", { name: "Take control" }));

    const panel = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>("[data-analysis-panel]");
      expect(element).toBeInTheDocument();
      return element!;
    });
    expect(panel).toHaveTextContent("Known later1");
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Eager Apprentice, known from a later reveal");
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAttribute("data-analysis-card", "future-known");

    const selfHandCard = view.container.querySelector<HTMLButtonElement>(
      '[data-card-id="self-hand"]',
    )!;
    fireEvent.contextMenu(selfHandCard, { clientX: 420, clientY: 720 });
    const contextMenu = view.getByRole("menu", { name: "Harnessed Dragon actions" });
    expect(contextMenu).toBeInTheDocument();
    fireEvent.click(view.getByRole("menuitem", { name: "Exhaust card" }));
    expect(view.container.querySelector('[data-card-id="self-hand"]'))
      .toHaveAttribute("data-card-exhausted", "true");

    fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-card-id="self-hand"]')!);
    expect(panel).toHaveTextContent("Harnessed Dragon");
    const transferValues = new Map<string, string>();
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      getData: (type: string) => transferValues.get(type) ?? "",
      setData: (type: string, value: string) => transferValues.set(type, value),
    };
    fireEvent.dragStart(
      view.container.querySelector<HTMLButtonElement>('[data-card-id="self-hand"]')!,
      { dataTransfer },
    );
    expect(view.container.querySelector('[data-analysis-board="true"]'))
      .toHaveAttribute("data-analysis-dragging", "true");
    const opponentBattlefieldDrop = view.container.querySelector<HTMLElement>(
      '[data-analysis-drop-player-id="opponent"][data-analysis-drop-zone="battlefieldA"]',
    )!;
    fireEvent.dragOver(opponentBattlefieldDrop, { dataTransfer });
    expect(opponentBattlefieldDrop).not.toHaveAttribute("data-analysis-drop-hover");
    const battlefieldDrop = view.container.querySelector<HTMLElement>(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="battlefieldA"]',
    )!;
    fireEvent.dragOver(battlefieldDrop, { dataTransfer });
    expect(battlefieldDrop).toHaveAttribute("data-analysis-drop-hover", "true");
    fireEvent.drop(battlefieldDrop, { dataTransfer });

    await waitFor(() => {
      expect(view.container.querySelector('[data-card-id="self-hand"]'))
        .toHaveAttribute("data-analysis-card", "what-if");
    });
    expect(battlefieldDrop).not.toHaveAttribute("data-analysis-drop-hover");
    expect(view.container.querySelector('[data-analysis-board="true"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-analysis-status="active"]'))
      .toHaveTextContent("What-if branch");

    fireEvent.click(view.getByRole("button", { name: "Undo" }));
    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="hand"] [data-card-id="self-hand"]',
    )).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Redo" }));
    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="battlefieldA"] [data-card-id="self-hand"]',
    )).toHaveAttribute("data-analysis-card", "what-if");

    fireEvent.contextMenu(
      view.container.querySelector<HTMLButtonElement>('[data-card-id="self-hand"]')!,
      { clientX: 420, clientY: 420 },
    );
    fireEvent.click(view.getByRole("menuitem", { name: "Restore to branch start" }));
    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="hand"] [data-card-id="self-hand"]',
    )).not.toHaveAttribute("data-analysis-card");

    fireEvent.contextMenu(
      view.container.querySelector<HTMLButtonElement>('[data-card-id="self-hand"]')!,
      { clientX: 520, clientY: 520 },
    );
    fireEvent.click(view.getByRole("menuitem", { name: "Add to chain" }));
    const chainCard = view.container.querySelector<HTMLButtonElement>(
      '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
    );
    expect(chainCard).toHaveAccessibleName("Harnessed Dragon, changed in analysis");
    expect(chainCard).toHaveAttribute("data-analysis-card", "what-if");
    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="hand"] [data-card-id="self-hand"]',
    )).not.toBeInTheDocument();

    fireEvent.contextMenu(chainCard!, { clientX: 620, clientY: 430 });
    fireEvent.click(view.getByRole("menuitem", { name: "Add target arrow" }));
    expect(panel).toHaveTextContent("Select a chain target");
    fireEvent.click(
      view.container.querySelector<HTMLButtonElement>('[data-card-id="opponent-hand"]')!,
    );
    await waitFor(() => {
      expect(view.container.querySelector(
        '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
      )).toHaveAttribute("data-analysis-chain-target-count", "1");
      expect(view.container.querySelectorAll('[data-analysis-target-arrow="true"]'))
        .toHaveLength(1);
    });

    const targetedChainCard = view.container.querySelector<HTMLButtonElement>(
      '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
    )!;
    expect(targetedChainCard).toHaveAccessibleName(
      "Harnessed Dragon, changed in analysis, 1 target linked",
    );
    fireEvent.contextMenu(targetedChainCard, { clientX: 620, clientY: 430 });
    expect(view.getByRole("menu", { name: "Harnessed Dragon actions" }))
      .toHaveTextContent("1 target linked");
    fireEvent.click(view.getByRole("menuitem", { name: "Add another target" }));
    const battlefieldTarget = view.container.querySelector<HTMLButtonElement>(
      "[data-battlefield-card]",
    )!;
    const battlefieldTargetId = battlefieldTarget.dataset.cardId!;
    fireEvent.click(battlefieldTarget);
    await waitFor(() => {
      const chainWithTargets = view.container.querySelector(
        '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
      );
      expect(chainWithTargets).toHaveAttribute("data-analysis-chain-target-count", "2");
      expect(chainWithTargets?.getAttribute("data-analysis-chain-target-ids"))
        .toContain(battlefieldTargetId);
      expect(view.container.querySelectorAll('[data-analysis-target-arrow="true"]'))
        .toHaveLength(2);
    });

    fireEvent.click(view.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-analysis-target-arrow="true"]'))
        .toHaveLength(1);
    });
    fireEvent.click(view.getByRole("button", { name: "Redo" }));
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-analysis-target-arrow="true"]'))
        .toHaveLength(2);
    });

    fireEvent.contextMenu(
      view.container.querySelector<HTMLButtonElement>(
        '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
      )!,
      { clientX: 620, clientY: 430 },
    );
    fireEvent.click(view.getByRole("menuitem", { name: "Clear target arrows" }));
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-analysis-target-arrow="true"]'))
        .toHaveLength(0);
    });

    fireEvent.contextMenu(
      view.container.querySelector<HTMLButtonElement>(
        '[data-analysis-chain-entry-id][data-card-id="self-hand"]',
      )!,
      { clientX: 620, clientY: 430 },
    );
    fireEvent.click(view.getByRole("menuitem", { name: "Return card from chain" }));
    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="self"][data-analysis-drop-zone="hand"] [data-card-id="self-hand"]',
    )).toHaveAttribute("data-analysis-card", "what-if");

    fireEvent.click(view.getByRole("button", { name: "Return to original replay" }));
    expect(view.container.querySelector("[data-analysis-panel]")).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-card-id="self-hand"]'))
      .not.toHaveAttribute("data-analysis-card");
    expect(view.container.querySelector('[data-card-id="opponent-hand"]'))
      .toHaveAccessibleName("Hidden card");
  });

  it("reveals both real hands across the board, opening, and mulligan in a consented combined replay", async () => {
    const replay = asConsentedCombinedReplay(mulliganReplay());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_combined_hands" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-combined-replay="open-hands"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-combined-replay="open-hands"]'))
      .toHaveTextContent("Combined replay · Open hands");
    expect(view.queryByRole("button", { name: "Cards up" })).not.toBeInTheDocument();
    const opponentBoardHand = view.container.querySelector<HTMLElement>(
      '[data-player-id="opponent"] [data-hand-cards]',
    );
    expect(opponentBoardHand?.querySelector('[data-card-id="opponent-mulligan-a"]'))
      .toHaveAccessibleName("Eager Apprentice");
    expect(opponentBoardHand?.querySelector('[data-card-hidden-at-battlefield="true"]'))
      .not.toBeInTheDocument();
    expect(opponentBoardHand?.querySelector('[data-card-code="OGN-031"]')).toBeInTheDocument();

    for (const scene of ["battlefields", "initiative", "opening"]) {
      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => {
        expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument();
      });
    }
    const opening = view.container.querySelector<HTMLElement>('[data-scene="opening"]');
    expect(opening?.querySelector('[data-card-id="opponent-mulligan-a"]'))
      .toHaveAccessibleName("Eager Apprentice");

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="mulligan"]')).toBeInTheDocument();
    });
    const opponentMulligan = view.container.querySelector<HTMLElement>(
      '[data-mulligan-player="opponent"]',
    );
    expect(opponentMulligan?.querySelector('[data-card-code="OGN-031"]')).toBeInTheDocument();
    expect(opponentMulligan?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(0);
  });

  it("provides a spoiler-safe private caster workspace and a clean recording feed", async () => {
    const replayId = "rp_caster_studio";
    window.localStorage.removeItem(`riftlite:caster-project:v1:${encodeURIComponent(replayId)}`);
    const replay = asConsentedCombinedReplay(mulliganReplay());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, {
      mode: "caster",
      replayId,
    }));

    await waitFor(() => {
      expect(view.container.querySelector("[data-caster-operator-panel]"))
        .toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-control="analysis"]')).not.toBeInTheDocument();
    expect(view.container.querySelector(
      '[data-player-id="opponent"] [data-card-id="opponent-mulligan-a"]',
    )).toHaveAccessibleName("Hidden card");

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(view.container.querySelector('[data-caster-clean="true"]')).not.toBeInTheDocument();

    const addNoteButton = view.getByRole("button", { name: "Add timestamped note" });
    addNoteButton.focus();
    fireEvent.keyDown(addNoteButton, { key: " " });
    expect(view.getByRole("button", { name: "Play replay" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(view.getByText("1 saved moment")).toBeInTheDocument());
    expect(view.getByLabelText("Caster bookmark markers").querySelectorAll("button"))
      .toHaveLength(1);

    const title = view.getByRole("textbox", { name: "Bookmark title" });
    fireEvent.keyDown(title, { key: "p" });
    expect(view.container.querySelector('[data-caster-clean="true"]')).not.toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: /Enter clean feed/i }));
    expect(view.container.querySelector('[data-caster-clean="true"]')).toBeInTheDocument();
    expect(view.container.querySelector("[data-caster-operator-panel]"))
      .not.toBeInTheDocument();
    expect(view.container.querySelector("[data-caster-lower-third]"))
      .toBeInTheDocument();
    expect(view.container.querySelector("[data-activity-panel]"))
      .not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Capture replay frame" }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "p" });
    expect(view.container.querySelector("[data-caster-operator-panel]"))
      .toBeInTheDocument();
    window.localStorage.removeItem(`riftlite:caster-project:v1:${encodeURIComponent(replayId)}`);
  });

  it("allows either public hand in a consented combined replay to enter a temporary branch", async () => {
    const replay = asConsentedCombinedReplay(mulliganReplay());
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_combined_analysis" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-combined-replay="open-hands"]')).toBeInTheDocument();
    });
    fireEvent.click(view.getByRole("button", { name: "Take control" }));
    expect(view.container.querySelector("[data-analysis-panel]")).toHaveTextContent("Known later0");

    const opponentCard = view.container.querySelector<HTMLButtonElement>(
      '[data-player-id="opponent"] [data-card-id="opponent-mulligan-a"]',
    )!;
    fireEvent.contextMenu(opponentCard, { clientX: 500, clientY: 240 });
    fireEvent.click(view.getByRole("menuitem", { name: "Base" }));

    expect(view.container.querySelector(
      '[data-analysis-drop-player-id="opponent"][data-analysis-drop-zone="base"] [data-card-id="opponent-mulligan-a"]',
    )).toHaveAttribute("data-analysis-card", "what-if");
    expect(view.container.querySelector(
      '[data-player-id="self"] [data-card-id="opponent-mulligan-a"]',
    )).not.toBeInTheDocument();
  });

  it("labels only an unrevealed Atlas hidden card while it is at a battlefield", async () => {
    const replay = sideboardingAtZeroReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");

    const selfBattlefieldCard = snapshot.snapshot.players.self.zones.battlefieldB[0];
    selfBattlefieldCard.fields.hidden = true;
    const revealedOpponentCard = snapshot.snapshot.players.opponent.zones.battlefieldA[0];
    revealedOpponentCard.fields.hidden = true;
    revealedOpponentCard.fields.revealedToOpponent = true;
    snapshot.snapshot.players.self.zones.hand[0].fields.hidden = true;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_atlas_hidden" }));

    const hiddenBattlefieldCard = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-card-id="self-battlefield-unit"]',
      );
      expect(element).toBeInTheDocument();
      return element!;
    });
    expect(hiddenBattlefieldCard).toHaveAttribute("data-card-hidden-at-battlefield", "true");
    expect(hiddenBattlefieldCard).toHaveAccessibleName("Black Rose Dignitary, hidden at battlefield");
    expect(hiddenBattlefieldCard).toHaveTextContent("Hidden");
    expect(view.container.querySelector('[data-card-id="opponent-battlefield-unit"]'))
      .not.toHaveAttribute("data-card-hidden-at-battlefield");
    expect(view.container.querySelector('[data-card-id="self-hand"]'))
      .not.toHaveAttribute("data-card-hidden-at-battlefield");
  });

  it("steps over Atlas synchronization packets and payment bookkeeping", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/?t=0.001");
    const replay = technicalSteppingReplay();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_technical_steps" }));

    try {
      fireEvent.click(await view.findByRole("button", { name: "More" }));
      await waitFor(() => expect(view.getByText("3 / 10")).toBeInTheDocument());

      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => expect(view.getByText("7 / 10")).toBeInTheDocument());

      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => expect(view.getByText("10 / 10")).toBeInTheDocument());

      fireEvent.click(view.getByRole("button", { name: "Previous action" }));
      await waitFor(() => expect(view.getByText("7 / 10")).toBeInTheDocument());
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("keeps card motion stable across Atlas reorder and rewind bookkeeping", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/?t=0.9");
    const replay = cardMotionBookkeepingReplay();
    const queuedFrames = new Map<number, FrameRequestCallback>();
    const animationCalls: Array<{ firstTransform: string; motionId: string }> = [];
    let frameId = 0;
    let now = 0;
    let cardMotionInFlight = false;
    let cardTranslationCancels = 0;

    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      queuedFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => queuedFrames.delete(id)));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (!(this instanceof HTMLElement)) return motionRect(0, 0, 0, 0);
      if (this.dataset.cardMotionId !== "self-hand") return motionRect(0, 0, 0, 0);
      const zone = this.closest<HTMLElement>("[data-analysis-drop-zone]")
        ?.dataset.analysisDropZone;
      if (zone === "hand") return motionRect(100, 720, 80, 112);
      if (zone === "base") {
        return cardMotionInFlight
          ? motionRect(350, 520, 80, 112)
          : motionRect(600, 520, 80, 112);
      }
      return motionRect(0, 0, 80, 112);
    });
    vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (keyframes) {
      const firstTransform = Array.isArray(keyframes) && typeof keyframes[0]?.transform === "string"
        ? keyframes[0].transform
        : "";
      const motionId = this.dataset.cardMotionId ?? "";
      animationCalls.push({ firstTransform, motionId });
      if (motionId === "self-hand" && firstTransform.startsWith("translate(")) {
        cardMotionInFlight = true;
      }
      const cardTranslation = motionId === "self-hand" && firstTransform.startsWith("translate(");
      return {
        cancel() {
          if (cardTranslation) cardTranslationCancels += 1;
        },
        pause() {},
        play() {},
      } as Animation;
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_motion_bookkeeping" }));
    const flushFrame = async (timestamp: number) => {
      now = timestamp;
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();
      await act(async () => callbacks.forEach((callback) => callback(timestamp)));
    };
    const cardTranslations = () => animationCalls.filter((call) => (
      call.motionId === "self-hand" && call.firstTransform.startsWith("translate(")
    ));

    try {
      await waitFor(() => {
        expect(view.container.querySelector('[data-card-motion-id="self-hand"]'))
          .toBeInTheDocument();
      });
      await flushFrame(0);
      animationCalls.length = 0;

      fireEvent.click(view.getByRole("button", { name: "Play replay" }));
      await flushFrame(35);
      await waitFor(() => {
        expect(view.container.querySelector(
          '[data-analysis-drop-zone="base"] [data-card-motion-id="self-hand"]',
        )).toBeInTheDocument();
      });
      expect(cardTranslations()).toHaveLength(1);

      // The rewind bookkeeping frame arrives while the first 430ms FLIP is
      // still visually halfway between hand and base. It must not start a
      // second translation from that transient bounding box.
      await flushFrame(80);
      expect(view.container.querySelector(
        '[data-analysis-drop-zone="base"] [data-card-motion-id="self-hand"]',
      )).toBeInTheDocument();
      expect(cardTranslations()).toHaveLength(1);
      expect(cardTranslationCancels).toBe(0);
    } finally {
      view.unmount();
      window.history.replaceState({}, "", previousUrl || "/");
    }
  });

  it("keys card motion to DOM slots and layout state, not transient bounds", () => {
    const root = document.createElement("div");
    const hand = document.createElement("div");
    const base = document.createElement("div");
    const card = document.createElement("button");
    card.dataset.cardMotionId = "card-1";
    card.dataset.cardSize = "board";
    card.dataset.cardExhausted = "false";
    hand.append(card);
    root.append(hand, base);

    const boundsSpy = vi.spyOn(card, "getBoundingClientRect")
      .mockReturnValueOnce(motionRect(100, 700, 80, 112))
      .mockReturnValueOnce(motionRect(475, 430, 80, 112));
    const initial = replayCardMotionLayoutSignature(root);
    expect(replayCardMotionLayoutSignature(root)).toBe(initial);
    expect(boundsSpy).not.toHaveBeenCalled();

    base.append(card);
    const moved = replayCardMotionLayoutSignature(root);
    expect(moved).not.toBe(initial);

    card.dataset.cardExhausted = "true";
    expect(replayCardMotionLayoutSignature(root)).not.toBe(moved);
  });

  it("hydrates opener art, keeps its shade mounted, and reveals the selected landscape battlefields", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    const sceneCodes = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-scene-content] [data-card-code]"),
      (element) => element.dataset.cardCode,
    );
    expect(sceneCodes).toEqual(expect.arrayContaining(["UNL-199", "UNL-172", "SFD-251", "OGN-232"]));
    expect(view.container.querySelector('[aria-label$=" runes"]')).not.toBeInTheDocument();

    const shade = view.container.querySelector("[data-scene-shade]");
    expect(shade).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Next action" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="battlefields"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector("[data-scene-shade]")).toBe(shade);
    const battlefieldCards = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-scene-content] [data-battlefield-card]"),
    );
    expect(battlefieldCards).toHaveLength(2);
    expect(battlefieldCards.map((element) => element.dataset.cardCode)).toEqual(["OGN-297", "SFD-218"]);
    expect(battlefieldCards.every((element) => Boolean(element.querySelector("img")))).toBe(true);
  });

  it("stages known mulligan cards leaving before their replacements enter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_mulligan" }));

    await advanceToMulligan(view);

    const selfHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="self"]');
    expect(selfHand).not.toBeNull();
    expect(selfHand).toHaveAttribute("data-mulligan-details", "exact");
    expect(selfHand).toHaveTextContent("1 card replaced");
    expect(selfHand?.querySelector(
      '[data-mulligan-card="leaving"] [data-card-id="self-mulligan-out"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-id="self-mulligan-in"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="kept"] [data-card-id="self-mulligan-kept"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"]')).toHaveTextContent("Out");
    expect(selfHand?.querySelector('[data-mulligan-card="entering"]')).toHaveTextContent("New");
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"]')).toHaveAttribute("aria-hidden", "true");
    expect(selfHand?.querySelector('[data-mulligan-card="leaving"] button')).toHaveAttribute("tabindex", "-1");
    expect(selfHand?.querySelector('[data-mulligan-card="entering"] button')).toHaveAttribute("tabindex", "-1");
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-code="UNL-152"]',
    )).toBeInTheDocument();
    expect(selfHand?.querySelector(
      '[data-mulligan-card="entering"] [data-card-id="self-opening-fifth"]',
    )).not.toBeInTheDocument();

    const opponentHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="opponent"]');
    expect(opponentHand).toHaveAttribute("data-mulligan-details", "exact");
    expect(opponentHand).toHaveTextContent("Opening hand kept");
    expect(opponentHand?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(2);
  });

  it("uses count-only card-back motion when opponent mulligan identities are hidden", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay({ opponentRedrawCount: 2 }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_hidden_mulligan" }));

    await advanceToMulligan(view);

    const opponentHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="opponent"]');
    expect(opponentHand).toHaveAttribute("data-mulligan-details", "count");
    expect(opponentHand).toHaveTextContent("2 cards replaced");
    expect(opponentHand?.querySelectorAll('[data-mulligan-card="leaving"]')).toHaveLength(2);
    expect(opponentHand?.querySelectorAll('[data-mulligan-card="entering"]')).toHaveLength(2);
    expect(opponentHand?.querySelectorAll('[aria-label="Hidden card"]')).toHaveLength(4);
    expect(opponentHand).not.toHaveTextContent("Replacement details unavailable");
  });

  it("waits for the capture player's delayed TCGA hand and shows the known redraw count honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: tcgaLaggedPerspectiveHandReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_tcga_lagged_hand" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    for (const scene of ["battlefields", "initiative", "opening"]) {
      fireEvent.click(view.getByRole("button", { name: "Next action" }));
      await waitFor(() => {
        expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument();
      });
    }

    const opening = view.container.querySelector<HTMLElement>('[data-scene="opening"]');
    expect(opening?.querySelector('[data-card-id="tcga-final-a"]')).toHaveAccessibleName("Ruin Runner");
    expect(opening?.querySelector('[data-card-id="tcga-final-b"]')).toHaveAccessibleName("Kayle, Justified");

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="mulligan"]')).toBeInTheDocument();
    });
    const selfHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="self"]');
    expect(selfHand).toHaveAttribute("data-mulligan-details", "count_unresolved");
    expect(selfHand).toHaveTextContent("2 cards replaced");
    expect(selfHand).toHaveTextContent("Replacement identities unavailable");
    expect(selfHand?.querySelector('[data-card-id="tcga-final-a"]')).toHaveAccessibleName("Ruin Runner");
    expect(selfHand?.querySelectorAll('[data-mulligan-card="leaving"]')).toHaveLength(0);
  });

  it("offers 6× and 10× and cycles the compact speed control through every option", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_speed_options" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-control="speed"]')).toBeInTheDocument();
    });
    const speedControl = view.container.querySelector<HTMLButtonElement>('[data-control="speed"]');
    for (const expected of [2, 4, 6, 10, 1]) {
      fireEvent.click(speedControl!);
      expect(speedControl).toHaveTextContent(`${expected}\u00d7`);
    }

    fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-control="more"]')!);
    expect(view.container.querySelector('[data-control="speed-6"]')).toHaveTextContent("6×");
    expect(view.container.querySelector('[data-control="speed-10"]')).toHaveTextContent("10×");
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-control="speed-10"]')!);
    expect(speedControl).toHaveTextContent("10×");
  });

  it("uses 6 and 0 as keyboard shortcuts for 6× and 10× playback", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_speed_shortcuts" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-control="speed"]')).toBeInTheDocument();
    });
    const speedControl = view.container.querySelector<HTMLButtonElement>('[data-control="speed"]');

    fireEvent.keyDown(window, { key: "6" });
    expect(speedControl).toHaveTextContent("6×");
    fireEvent.keyDown(window, { key: "0" });
    expect(speedControl).toHaveTextContent("10×");

    fireEvent.keyDown(window, { key: "?" });
    expect(view.getByRole("dialog", { name: "Keyboard shortcuts" }))
      .toHaveTextContent("1 / 2 / 4 / 6 / 0");
    expect(view.getByRole("dialog", { name: "Keyboard shortcuts" }))
      .toHaveTextContent("0 selects 10×");
  });

  it("scales mulligan motion with the selected 10× replay speed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: mulliganReplay(),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_fast_mulligan" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-control="speed"]')).toBeInTheDocument();
    });
    const speedControl = view.container.querySelector<HTMLButtonElement>('[data-control="speed"]');
    fireEvent.click(speedControl!);
    fireEvent.click(speedControl!);
    fireEvent.click(speedControl!);
    fireEvent.click(speedControl!);
    expect(speedControl).toHaveTextContent("10×");

    await advanceToMulligan(view);

    const selfHand = view.container.querySelector<HTMLElement>('[data-mulligan-player="self"]');
    expect(selfHand?.style.getPropertyValue("--mulligan-duration")).toBe("205ms");
    expect(selfHand?.style.getPropertyValue("--mulligan-short-duration")).toBe("155ms");
    const secondSlot = selfHand?.querySelectorAll<HTMLElement>("[data-mulligan-slot]")[1];
    expect(secondSlot?.style.getPropertyValue("--mulligan-delay")).toBe("7.5ms");
  });

  it("renders real rune cards and explicit duplicate markers without the old rune counter", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-rune-rail]")).toHaveLength(2);
    });

    expect(view.container.querySelectorAll("[data-rune-card]")).toHaveLength(2);
    expect(view.container.querySelectorAll("[data-rune-slot]")).toHaveLength(22);
    expect(view.container.querySelectorAll('[data-rune-deck-count="11"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-rune-card][data-card-exhausted="true"]')).toHaveLength(1);
    expect(view.container.querySelector('[aria-label$=" runes"]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-card-duplicate="true"]')).toHaveTextContent("Duplicate");
    expect(Array.from(view.container.querySelectorAll<HTMLElement>("[data-player-score]"), (element) => (
      element.dataset.playerScore
    ))).toEqual(["5", "7"]);
  });

  it("renders projected labels and counters and groups non-adjacent equipment under its host", async () => {
    const replay = sideboardingAtZeroReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");

    const host = {
      ...replayCard("card_host", "Akali", "OGN-001", "mainDeck"),
      fields: {
        cardCode: "OGN-001",
        customLabels: ["Empowered", ""],
        name: "Akali",
        redCounter: -4,
        source: "mainDeck",
        whiteCounter: 0,
      },
    };
    const guardianAngel = {
      ...replayCard("card_guardian", "Guardian Angel", "OGN-002", "mainDeck"),
      fields: {
        attachedToCardId: host.id,
        cardCode: "OGN-002",
        name: "Guardian Angel",
        source: "mainDeck",
      },
    };
    const longSword = {
      ...replayCard("card_sword", "Long Sword", "OGN-003", "mainDeck"),
      fields: {
        attachedToCardId: host.id,
        cardCode: "OGN-003",
        name: "Long Sword",
        source: "mainDeck",
      },
    };
    const unrelated = replayCard("card_other", "Stellacorn Herder", "OGN-004", "mainDeck");
    // Mirrors the observed replay: an attachment can precede its host and an
    // unrelated card can sit between them because zone reorder is not projected.
    snapshot.snapshot.players.self.zones.base = [guardianAngel, unrelated, host, longSword];
    snapshot.snapshot.players.opponent.zones.hand[0].fields = {
      ...snapshot.snapshot.players.opponent.zones.hand[0].fields,
      customLabels: ["Secret"],
      redCounter: -4,
      whiteCounter: 0,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    const view = render(createElement(ReplayV2Player, { replayId: "rp_card_polish" }));
    const group = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-card-attachment-group="card_host"]',
      );
      expect(element).toBeInTheDocument();
      return element!;
    });

    expect(group).toHaveAttribute("data-attachment-count", "2");
    expect(group.style.getPropertyValue("--attachment-count")).toBe("2");
    expect(group.querySelector('[data-card-attachment-layer="host"] [data-card-id="card_host"]'))
      .toBeInTheDocument();
    const attachmentLayers = Array.from(
      group.querySelectorAll<HTMLElement>('[data-card-attachment-layer="attachment"]'),
    );
    expect(attachmentLayers).toHaveLength(2);
    expect(attachmentLayers.map((layer) => layer.style.getPropertyValue("--attachment-index")))
      .toEqual(["0", "1"]);
    expect(group.querySelector('[data-card-id="card_guardian"]'))
      .toHaveAttribute("data-card-attached-to", "card_host");
    expect(group.querySelector('[data-card-id="card_sword"]'))
      .toHaveAttribute("data-card-attached-to", "card_host");
    expect(view.container.querySelectorAll('[data-card-id="card_host"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-card-id="card_guardian"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-card-id="card_other"]')).toBeInTheDocument();
    const faceDownOpponentCard = view.container.querySelector<HTMLElement>(
      '[data-card-id="opponent-hand"]',
    );
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-label-count");
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-white-counter");
    expect(faceDownOpponentCard).not.toHaveAttribute("data-card-red-counter");
    expect(faceDownOpponentCard?.querySelector("[data-card-custom-label]")).not.toBeInTheDocument();
    expect(faceDownOpponentCard?.querySelector("[data-card-counter]")).not.toBeInTheDocument();

    const hostTile = group.querySelector<HTMLElement>('[data-card-id="card_host"]');
    expect(hostTile).toHaveAttribute("data-card-label-count", "1");
    expect(hostTile).toHaveAttribute("data-card-white-counter", "0");
    expect(hostTile).toHaveAttribute("data-card-red-counter", "-4");
    expect(hostTile?.querySelector('[data-card-custom-label="Empowered"]')).toHaveTextContent("Empowered");
    expect(hostTile?.querySelector('[data-card-counter="white"]')).toHaveTextContent("0");
    expect(hostTile?.querySelector('[data-card-counter="red"]')).toHaveTextContent("-4");

    fireEvent.mouseEnter(hostTile!);
    await waitFor(() => {
      expect(view.container.querySelector('[data-hover-card-custom-label="Empowered"]'))
        .toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-hover-card-counter="white"]')).toHaveTextContent("0");
    expect(view.container.querySelector('[data-hover-card-counter="red"]')).toHaveTextContent("-4");

    const attachedTile = group.querySelector<HTMLElement>('[data-card-id="card_guardian"]');
    fireEvent.mouseEnter(attachedTile!);
    expect(view.container.querySelector('[data-hover-card-name="Guardian Angel"]')).toBeInTheDocument();
    fireEvent.click(attachedTile!);
    fireEvent.mouseLeave(attachedTile!);
    await waitFor(() => {
      expect(view.container.querySelector("[data-card-inspector] h2")).toHaveTextContent("Guardian Angel");
    });
  });

  it("keeps each rune rail adjacent to its hand instead of overlaying it", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-hand-layout]")).toHaveLength(2);
    });
    for (const player of view.container.querySelectorAll<HTMLElement>("[data-player-id]")) {
      const handRow = player.querySelector("[data-hand-row]");
      const runeRail = player.querySelector("[data-rune-rail]");
      expect(handRow).toBeInTheDocument();
      expect(runeRail).toBeInTheDocument();
      expect(handRow?.parentElement).toBe(runeRail?.parentElement);
    }
    expect(view.container.querySelectorAll('[data-card-size="hand"]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-card-size="board"]').length).toBeGreaterThanOrEqual(3);
    expect(view.container.querySelectorAll('[data-card-size="rune"]')).toHaveLength(2);
  });

  it("shows selected battlefield scans in a landscape inspector frame", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-battlefield-zone="battlefieldA"] [data-battlefield-card]'))
        .toBeInTheDocument();
    });
    const battlefield = view.container.querySelector<HTMLElement>(
      '[data-battlefield-zone="battlefieldA"] [data-battlefield-card]',
    );
    expect(battlefield).not.toBeNull();
    fireEvent.mouseEnter(battlefield!);

    await waitFor(() => {
      expect(view.container.querySelector('[data-inspector-battlefield="true"]')).toBeInTheDocument();
    });
    expect(view.container.querySelector('[data-hover-card-preview][data-hover-battlefield="true"]'))
      .toBeInTheDocument();
    expect(view.container.querySelector("[data-card-inspector]")).toBeInTheDocument();
    expect(view.container.querySelector("[data-inspector-art-frame]")).toBeInTheDocument();
    expect(view.container.querySelector("[data-activity-panel]")).toBeInTheDocument();
  });

  it("shows a large transient preview for board and hero cards only while hovered", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    const handCard = await view.findByRole("button", { name: "Harnessed Dragon" });
    fireEvent.mouseEnter(handCard);
    expect(view.container.querySelector('[data-hover-card-name="Harnessed Dragon"]'))
      .toBeInTheDocument();

    fireEvent.mouseLeave(handCard);
    await waitFor(() => {
      expect(view.container.querySelector("[data-hover-card-preview]")).not.toBeInTheDocument();
    });

    const heroStack = view.container.querySelector('[data-hero-stack="bottom"]');
    const champion = heroStack?.querySelector<HTMLElement>('[aria-label="LeBlanc, Fragmented"]');
    expect(champion).not.toBeNull();
    fireEvent.mouseEnter(champion!);
    expect(view.container.querySelector('[data-hover-card-name="LeBlanc, Fragmented"]'))
      .toBeInTheDocument();
  });

  it("removes a played champion from its visual slot without losing opener identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: sideboardingAtZeroReplay({ championPlayed: true }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
    });
    const heroStack = view.container.querySelector('[data-hero-stack="bottom"]');
    expect(heroStack?.querySelector('[aria-label="LeBlanc, Fragmented"]')).not.toBeInTheDocument();
    expect(heroStack).toHaveTextContent("Champion");
    expect(view.container.querySelector(
      '[data-player-id="self"] [aria-label="LeBlanc, Fragmented"]',
    )).toBeInTheDocument();
    expect(view.container.querySelector(
      '[data-scene-content] [data-card-code="UNL-172"]',
    )).toBeInTheDocument();
  });

  it("shows the large card preview while browsing trash and clears it on close", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: sideboardingAtZeroReplay({ includeTrash: true }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    const openTrash = await view.findByRole("button", { name: "Open trash, 1 cards" });
    fireEvent.click(openTrash);
    const trashCard = await view.findByRole("button", { name: "Solari Soldier" });
    fireEvent.mouseEnter(trashCard);

    expect(view.container.querySelector('[data-hover-card-name="Solari Soldier"]'))
      .toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Close trash" }));
    expect(view.container.querySelector("[data-hover-card-preview]")).not.toBeInTheDocument();
  });

  it("opens the compact banished zone control below the deck", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: sideboardingAtZeroReplay({ includeBanished: true }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    const openBanished = await view.findByRole("button", {
      name: "Open banished cards, 1 card",
    });
    expect(openBanished).toHaveAttribute("data-open-banished");
    expect(openBanished).toHaveAttribute("data-has-banished", "true");
    fireEvent.click(openBanished);

    expect(view.getByRole("dialog", { name: "LeBlanc banished cards" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Daring Poro" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Close banished cards" }));
    expect(view.container.querySelector("[data-banished-overlay]")).not.toBeInTheDocument();
  });

  it("announces a banish transition from the provider-neutral replay timeline", async () => {
    const previousUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", "/replays/rp_banish?t=1");
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        replay: banishedTransitionReplay(),
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })));
      const view = render(createElement(ReplayV2Player, { replayId: "rp_banish" }));

      await waitFor(() => {
        expect(view.container.querySelector('[data-banished-event="true"]'))
          .toHaveTextContent("LeBlanc banished Daring Poro");
      });
    } finally {
      window.history.replaceState({}, "", previousUrl);
    }
  });

  it("pairs seat-one cards with the capture player's left battlefield", async () => {
    const view = render(createElement(ReplayV2Player, { replayId: "rp_test" }));

    await waitFor(() => {
      expect(view.container.querySelectorAll("[data-battlefield-zone]")).toHaveLength(2);
    });
    const lanes = Array.from(
      view.container.querySelectorAll<HTMLElement>("[data-battlefield-zone]"),
    );

    expect(lanes.map((lane) => ({
      battlefield: lane.dataset.battlefieldName,
      owner: lane.dataset.battlefieldOwner,
      zone: lane.dataset.battlefieldZone,
    }))).toEqual([
      { battlefield: "Windswept Hillock", owner: "self", zone: "battlefieldB" },
      { battlefield: "Sunken Temple", owner: "opponent", zone: "battlefieldA" },
    ]);
    expect(lanes[0].querySelector('[aria-label="Black Rose Dignitary"]')).toBeInTheDocument();
    expect(lanes[1].querySelector('[aria-label="Eager Drakehound"]')).toBeInTheDocument();
    expect(lanes[0].querySelector('[aria-label="Eager Drakehound"]')).not.toBeInTheDocument();
    for (const lane of lanes) {
      const battlefieldDock = lane.querySelector("[data-battlefield-card-dock]");
      const unitRows = Array.from(lane.querySelectorAll("[data-battlefield-unit-row]"));
      expect(battlefieldDock).toBeInTheDocument();
      expect(unitRows).toHaveLength(2);
      expect(unitRows.every((row) => Boolean(
        battlefieldDock?.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
      ))).toBe(true);
    }
  });

  it("projects owner-relative TCGA B1/B2 zones onto both selected battlefields", async () => {
    const replay = sideboardingAtZeroReplay();
    const snapshot = replay.events.find((event) => event.kind === "snapshot");
    if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");
    const self = snapshot.snapshot.players.self;
    const opponent = snapshot.snapshot.players.opponent;
    self.fields = { ...self.fields, provider: "tcga", selectedBattlefield: "Risen Altar" };
    opponent.fields = { ...opponent.fields, provider: "tcga", selectedBattlefield: "Star Spring" };
    self.zones.battlefieldA = [replayCard("self-own", "Ambessa, The Wolf", "VEN-084", "mainDeck")];
    self.zones.battlefieldB = [replayCard("self-opposing", "Honest Broker", "OGN-081", "mainDeck")];
    opponent.zones.battlefieldA = [replayCard("opponent-own", "Mournful Witness", "OGN-109", "mainDeck")];
    opponent.zones.battlefieldB = [replayCard("opponent-opposing", "Twilight Reveler", "OGN-171", "mainDeck")];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));

    const view = render(createElement(ReplayV2Player, { replayId: "tcga_owner_relative_lanes" }));
    const lanes = await waitFor(() => {
      const elements = Array.from(
        view.container.querySelectorAll<HTMLElement>("[data-battlefield-zone]"),
      );
      expect(elements).toHaveLength(2);
      return elements;
    });

    expect(lanes[0]).toHaveAttribute("data-battlefield-name", "Risen Altar");
    expect(lanes[0].querySelector("[data-battlefield-card] img"))
      .toHaveAttribute("src", "https://cdn.piltoverarchive.com/cards/VEN-163.webp");
    expect(lanes[0].querySelector('[aria-label="Ambessa, The Wolf"]')).toBeInTheDocument();
    expect(lanes[0].querySelector('[aria-label="Twilight Reveler"]')).toBeInTheDocument();
    expect(lanes[0].querySelector('[aria-label="Honest Broker"]')).not.toBeInTheDocument();
    expect(lanes[1]).toHaveAttribute("data-battlefield-name", "Star Spring");
    expect(lanes[1].querySelector('[aria-label="Honest Broker"]')).toBeInTheDocument();
    expect(lanes[1].querySelector('[aria-label="Mournful Witness"]')).toBeInTheDocument();
  });

  it("shows a truthful processing state for a 202 replay summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: { status: "processing" },
    }), {
      headers: { "content-type": "application/json" },
      status: 202,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rl2_processing" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Replay processing" })).toBeInTheDocument();
    });
    expect(view.getByText(/retry automatically/i)).toBeInTheDocument();
    expect(view.queryByText(/has not been normalized/i)).not.toBeInTheDocument();
    view.unmount();
  });

  it("surfaces an owner-visible failure from a 202 replay summary", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: {
        status: "failed",
        failure: { message: "The capture could not be normalized." },
      },
    }), {
      headers: { "content-type": "application/json" },
      status: 202,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rl2_failed" }));

    await waitFor(() => {
      expect(view.getByText("The capture could not be normalized.")).toBeInTheDocument();
    });
    expect(view.getByRole("heading", { name: "Replay unavailable" })).toBeInTheDocument();
  });

  it("anchors Game 2 sideboarding to the confirmed local submission and animates exact quantities", async () => {
    const replay = bo3SideboardingReplay({ includeResult: true });
    addLegacyGameTwoCheckpoint(replay);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay,
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_bo3_sideboard" }));

    await advanceToGameTwo(view);

    const transition = view.container.querySelector<HTMLElement>("[data-series-transition]");
    expect(transition).toHaveAttribute("data-series-score", "1-0");
    expect(transition).toHaveTextContent("Best of 3");
    expect(transition).toHaveTextContent("Game 2");
    expect(transition?.querySelector("[data-series-score-bottom]")).toHaveTextContent("1");
    expect(transition?.querySelector("[data-series-score-top]")).toHaveTextContent("0");

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="sideboarding"]')).toBeInTheDocument();
    });

    const scene = view.container.querySelector<HTMLElement>('[data-scene="sideboarding"]');
    const sideboard = scene?.querySelector<HTMLElement>("[data-sideboard-status]");
    expect(sideboard).toHaveAttribute("data-sideboard-status", "exact");
    expect(sideboard).toHaveAttribute("data-sideboard-action-index", "7");
    expect(sideboard?.querySelectorAll('[data-sideboard-card="out"]')).toHaveLength(2);
    expect(sideboard?.querySelectorAll('[data-sideboard-card="in"]')).toHaveLength(2);
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [data-card-code="OGN-010"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [aria-label="Name Only Out"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [data-card-code="OGN-020"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [aria-label="Name Only In"]'))
      .toBeInTheDocument();
    expect(sideboard?.querySelector('[data-sideboard-card="out"] [data-sideboard-quantity="2"]'))
      .toHaveTextContent("×2");
    expect(sideboard?.querySelector('[data-sideboard-card="in"] [data-sideboard-quantity="2"]'))
      .toHaveTextContent("×2");
    expect(sideboard?.querySelector('[data-opponent-sideboard="locked"]')).toHaveTextContent(
      "Opponent sideboard choices stay hidden",
    );
    expect(view.container.querySelectorAll("[data-battlefield-card]")).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument());
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="battlefields"]')).toBeInTheDocument());
    const gameTwoBattlefields = Array.from(
      view.container.querySelectorAll<HTMLElement>('[data-scene="battlefields"] [data-battlefield-card]'),
    );
    expect(gameTwoBattlefields.map((element) => element.dataset.cardCode)).toEqual(["OGN-289", "UNL-215"]);
    expect(gameTwoBattlefields[0]).toHaveTextContent("Targon's Peak");
    expect(gameTwoBattlefields[0]).toHaveTextContent("LeBlanc");
    expect(gameTwoBattlefields[1]).toHaveTextContent("Star Spring");
    expect(gameTwoBattlefields[1]).toHaveTextContent("Fiora");
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => expect(view.container.querySelector('[data-scene="first_player"]')).toBeInTheDocument());
    expect(view.container.querySelector("[data-first-player-scene]")).toHaveTextContent("will take the first action");
    expect(view.queryByText("d20")).not.toBeInTheDocument();
  });

  it("shows both submitted sideboard changes in a consented combined replay", async () => {
    const replay = asConsentedCombinedReplay(bo3SideboardingReplay({ includeResult: true }));
    addOpponentSideboardDetails(replay);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ replay }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_combined_sideboard" }));

    await advanceToGameTwo(view);
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector('[data-scene="sideboarding"]')).toBeInTheDocument();
    });

    const sideboard = view.container.querySelector<HTMLElement>("[data-sideboard-status]");
    expect(sideboard).toHaveAttribute("data-sideboard-mode", "open-hands");
    expect(sideboard?.querySelector('[data-opponent-sideboard="locked"]')).not.toBeInTheDocument();
    const self = sideboard?.querySelector<HTMLElement>('[data-sideboard-player="LeBlanc"]');
    const opponent = sideboard?.querySelector<HTMLElement>('[data-sideboard-player="Fiora"]');
    expect(self).toHaveAttribute("data-sideboard-player-status", "exact");
    expect(opponent).toHaveAttribute("data-sideboard-player-status", "exact");
    expect(opponent).toHaveAttribute("data-sideboard-player-action-index", "6");
    expect(opponent?.querySelector('[data-sideboard-card="out"] [data-card-code="OGN-030"]'))
      .toBeInTheDocument();
    expect(opponent?.querySelector('[data-sideboard-card="in"] [data-card-code="OGN-040"]'))
      .toBeInTheDocument();
  });

  it("keeps BO3 identity visible without inventing a missing series score", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      replay: bo3SideboardingReplay({ includeResult: false }),
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
    const view = render(createElement(ReplayV2Player, { replayId: "rp_bo3_no_result" }));

    await advanceToGameTwo(view);

    const transition = view.container.querySelector<HTMLElement>("[data-series-transition]");
    expect(transition).toHaveAttribute("data-series-score", "unknown");
    expect(transition).toHaveTextContent("Best of 3");
    expect(transition).toHaveTextContent("Game 2");
    expect(transition).toHaveTextContent("Series score unavailable");
  });

  it("enters gameplay after the virtual prelude instead of replaying setup phases", () => {
    const game = sideboardingAtZeroReplay().series.games[0];
    game.phases.push({
      phase: "in_game",
      rawPhase: "in_game",
      startEventIndex: 2,
      endEventIndex: 2,
      startedAtMs: 640,
      endedAtMs: 1_000,
    });
    expect(replayGamePlaybackStartMs(game)).toBe(640);
  });
});

function sideboardingAtZeroReplay(options: {
  championPlayed?: boolean;
  includeBanished?: boolean;
  includeTrash?: boolean;
} = {}): CanonicalReplayV2 {
  const selfChampion = replayCard(
    "self-champion",
    "LeBlanc, Fragmented",
    "UNL-172",
    "champion",
  );
  const snapshot = {
    room: {
      phase: "sideboarding" as const,
      rawPhase: "sideboarding",
      gameNumber: 1,
      fields: {},
    },
    players: {
      self: {
        id: "self",
        name: "LeBlanc",
        seat: 1,
        score: 7,
        fields: { selectedBattlefield: "Windswept Hillock" },
        boardFields: {},
        zones: {
          base: [{
            ...replayCard("self-duplicate", "Ruined Rex", "UNL-067", "mainDeck"),
            fields: {
              cardCode: "UNL-067",
              isDuplicate: true,
              name: "Ruined Rex",
              source: "mainDeck",
            },
          }, ...(options.championPlayed ? [selfChampion] : [])],
          battlefieldB: [replayCard(
            "self-battlefield-unit",
            "Black Rose Dignitary",
            "UNL-152",
            "mainDeck",
          )],
          champion: options.championPlayed ? [] : [selfChampion],
          hand: [replayCard("self-hand", "Harnessed Dragon", "OGN-015", "mainDeck")],
          legend: [replayCard("self-legend", "LeBlanc, Deceiver", "UNL-199", "legend")],
          runeArea: [{
            ...replayCard("self-rune", "Order Rune", "OGN-214", "rune"),
            exhausted: true,
            fields: {
              cardCode: "OGN-214",
              exhausted: true,
              name: "Order Rune",
              source: "rune",
            },
          }],
          runeDeck: Array.from({ length: 11 }, (_, index) => hiddenRune(`self-rune-deck-${index}`)),
          banished: options.includeBanished
            ? [replayCard("self-banished", "Daring Poro", "OGN-135", "mainDeck")]
            : [],
          trash: options.includeTrash
            ? [replayCard("self-trash", "Solari Soldier", "OGN-125", "mainDeck")]
            : [],
        },
      },
      opponent: {
        id: "opponent",
        name: "Fiora",
        seat: 0,
        score: 5,
        fields: { selectedBattlefield: "Sunken Temple" },
        boardFields: {},
        zones: {
          battlefieldA: [replayCard(
            "opponent-battlefield-unit",
            "Eager Drakehound",
            "SFD-006",
            "mainDeck",
          )],
          champion: [replayCard("opponent-champion", "Fiora, Victorious", "OGN-232", "champion")],
          hand: [replayCard("opponent-hand", "Eager Apprentice", "OGN-031", "mainDeck")],
          legend: [replayCard("opponent-legend", "Fiora, Grand Duelist", "SFD-251", "legend")],
          runeArea: [replayCard("opponent-rune", "Body Rune", "OGN-126", "rune")],
          runeDeck: Array.from({ length: 11 }, (_, index) => hiddenRune(`opponent-rune-deck-${index}`)),
        },
      },
    },
    chain: [],
    log: [],
  };
  return {
    schema: "riftlite-canonical-replay",
    version: 2,
    id: "rp_test",
    source: {
      schema: "riftreplay-raw-capture",
      version: 1,
      captureSessionId: "capture-test",
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      messageCount: 1,
    },
    series: {
      id: "series-test",
      perspectivePlayerId: "self",
      format: "bo1",
      bestOf: 1,
      roomCode: "TEST",
      startedAt: 1_000,
      endedAt: 2_000,
      participants: [
        { id: "self", name: "LeBlanc", isPerspective: true, fields: {} },
        { id: "opponent", name: "Fiora", isPerspective: false, fields: {} },
      ],
      games: [{
        id: "game-1",
        ordinal: 1,
        gameNumber: 1,
        sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["instance-1"] },
        startedAt: 1_000,
        endedAt: 2_000,
        startedAtMs: 0,
        endedAtMs: 1_000,
        eventStartIndex: 0,
        eventEndIndex: 2,
        phases: [{
          phase: "sideboarding",
          rawPhase: "sideboarding",
          startEventIndex: 1,
          endEventIndex: 2,
          startedAtMs: 0,
          endedAtMs: 0,
        }],
      }],
    },
    events: [
      {
        id: "event-boundary",
        index: 0,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "game_boundary",
        boundary: "start",
        gameOrdinal: 1,
        gameNumber: 1,
        reason: "series_start",
      },
      {
        id: "event-phase",
        index: 1,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "phase",
        phase: "sideboarding",
        rawPhase: "sideboarding",
        gameNumber: 1,
      },
      {
        id: "event-snapshot",
        index: 2,
        at: 1_000,
        atMs: 0,
        sourceMessageId: "message-0",
        gameId: "game-1",
        kind: "snapshot",
        snapshot,
      },
    ],
    unknownEvents: [],
    diagnostics: [],
    checkpoints: [],
  };
}

function replayWithDuration(durationMs: number): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  replay.series.endedAt = replay.series.startedAt + durationMs;
  const game = replay.series.games[0];
  if (game) {
    game.endedAt = game.startedAt + durationMs;
    game.endedAtMs = durationMs;
  }
  return replay;
}

function asConsentedCombinedReplay(replay: CanonicalReplayV2): CanonicalReplayV2 {
  replay.collaboration = {
    schema: "riftlite-dual-perspective",
    version: 1,
    mode: "dual-perspective",
    sourceReplayIds: ["source-self", "source-opponent"],
    sourceCanonicalSha256s: ["a".repeat(64), "b".repeat(64)],
    perspectivePlayerIds: ["self", "opponent"],
    informationPolicy: "consented_full_information",
    confidence: "exact",
    diagnostics: {
      primarySourceReplayId: "source-self",
      pairedSnapshotEvents: 1,
      pairedActionEvents: 1,
      unpairedPrimaryEvents: 0,
      unpairedSecondaryEvents: 0,
      enrichedCards: 2,
      enrichedFields: 2,
      coveragePercent: 100,
      warningCodes: [],
    },
  };
  return replay;
}

async function advanceToMulligan(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
  });
  for (const scene of ["battlefields", "initiative", "opening", "mulligan"]) {
    fireEvent.click(view.getByRole("button", { name: "Next action" }));
    await waitFor(() => {
      expect(view.container.querySelector(`[data-scene="${scene}"]`)).toBeInTheDocument();
    });
  }
}

async function advanceToGameTwo(view: ReturnType<typeof render>) {
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="matchup"]')).toBeInTheDocument();
  });
  fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => {
    expect(view.container.querySelector('[data-scene="game_transition"]')).toBeInTheDocument();
  }, { timeout: 5_000 });
}

function mulliganReplay(options: { opponentRedrawCount?: number } = {}): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const phaseEvent = replay.events[1];
  const snapshotEvent = replay.events[2];
  if (phaseEvent.kind !== "phase" || snapshotEvent.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its setup events.");
  }

  const opponentRedrawCount = options.opponentRedrawCount ?? 0;
  const selfKept = replayCard("self-mulligan-kept", "Harnessed Dragon", "OGN-015", "mainDeck");
  const selfLeaving = replayCard("self-mulligan-out", "Black Rose Dignitary", "UNL-152", "mainDeck");
  // A different instance of the same printed card is still a real replacement.
  const selfEntering = replayCard("self-mulligan-in", "Black Rose Dignitary", "UNL-152", "mainDeck");
  const selfOpeningFifth = replayCard("self-opening-fifth", "Soaring Scout", "OGN-020", "mainDeck");
  snapshotEvent.snapshot.room.phase = "mulligan";
  snapshotEvent.snapshot.room.rawPhase = "mulligan";
  snapshotEvent.snapshot.players.self.zones.hand = [selfKept, selfLeaving];
  snapshotEvent.snapshot.players.opponent.zones.hand = opponentRedrawCount
    ? [hiddenCard("opponent-mulligan-a"), hiddenCard("opponent-mulligan-b")]
    : [
        replayCard("opponent-mulligan-a", "Eager Apprentice", "OGN-031", "mainDeck"),
        replayCard("opponent-mulligan-b", "Eager Drakehound", "SFD-006", "mainDeck"),
      ];

  phaseEvent.phase = "mulligan";
  phaseEvent.rawPhase = "mulligan";
  replay.series.games[0].eventEndIndex = 5;
  replay.series.games[0].phases = [
    {
      phase: "mulligan",
      rawPhase: "mulligan",
      startEventIndex: 1,
      endEventIndex: 3,
      startedAtMs: 0,
      endedAtMs: 300,
    },
    {
      phase: "in_game",
      rawPhase: "in_game",
      startEventIndex: 4,
      endEventIndex: 5,
      startedAtMs: 350,
      endedAtMs: 350,
    },
  ];
  replay.events.push({
    id: "event-opponent-submit-mulligan",
    index: 3,
    at: 1_300,
    atMs: 300,
    sourceMessageId: "message-3",
    gameId: "game-1",
    kind: "action",
    actionType: "submit_mulligan",
    actorPlayerId: "opponent",
    action: opponentRedrawCount ? {} : { cardIds: [] },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-3",
    },
    patch: {
      sequence: 3,
      operations: [{
        id: "opponent-mulligan-playback",
        op: "set_room_fields",
        fields: {
          mulliganPlaybackByPlayerId: {
            opponent: { draws: [], redrawCount: opponentRedrawCount },
          },
        },
      }],
    },
  });
  replay.events.push({
    id: "event-in-game-phase",
    index: 4,
    at: 1_350,
    atMs: 350,
    sourceMessageId: "message-4",
    gameId: "game-1",
    kind: "phase",
    phase: "in_game",
    rawPhase: "in_game",
    gameNumber: 1,
  });
  replay.events.push({
    id: "event-self-submit-mulligan",
    index: 5,
    at: 1_350,
    atMs: 350,
    sourceMessageId: "message-4",
    gameId: "game-1",
    kind: "action",
    actionType: "submit_mulligan",
    actorPlayerId: "self",
    action: { cardIds: [selfLeaving.id] },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-4",
    },
    patch: {
      sequence: 4,
      operations: [
        {
          id: "self-mulligan-playback",
          op: "set_room_fields",
          fields: {
            mulliganPlaybackByPlayerId: {
              self: {
                draws: [
                  { cardId: selfEntering.id, kind: "refill" },
                  { cardId: selfOpeningFifth.id, kind: "opening" },
                ],
                redrawCount: 1,
              },
            },
          },
        },
        {
          id: "remove-mulligan-card",
          op: "zone_remove",
          playerId: "self",
          zone: "hand",
          cardIds: [selfLeaving.id],
        },
        {
          id: "draw-mulligan-card",
          op: "zone_insert",
          playerId: "self",
          zone: "hand",
          index: 1,
          cards: [selfEntering, selfOpeningFifth],
        },
      ],
    },
  });
  return replay;
}

function tcgaLaggedPerspectiveHandReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const sourceSnapshot = replay.events.find((event) => event.kind === "snapshot");
  if (!sourceSnapshot || sourceSnapshot.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its initial snapshot.");
  }
  const earlySnapshot = structuredClone(sourceSnapshot.snapshot);
  earlySnapshot.room.phase = "mulligan";
  earlySnapshot.room.rawPhase = "tcga:mulligan";
  earlySnapshot.players.self.zones.hand = [];
  earlySnapshot.players.opponent.zones.hand = [
    hiddenCard("tcga-opponent-hidden-a"),
    hiddenCard("tcga-opponent-hidden-b"),
    hiddenCard("tcga-opponent-hidden-c"),
    hiddenCard("tcga-opponent-hidden-d"),
  ];
  const finalSnapshot = structuredClone(earlySnapshot);
  finalSnapshot.players.self.zones.hand = [
    replayCard("tcga-final-a", "Ruin Runner", "SFD-105", "mainDeck"),
    replayCard("tcga-final-b", "Kayle, Justified", "VEN-134", "mainDeck"),
    replayCard("tcga-final-c", "Sabotage", "OGN-156", "mainDeck"),
    replayCard("tcga-final-d", "Repulse", "UNL-106", "mainDeck"),
    replayCard("tcga-final-e", "Punch First", "SFD-097", "mainDeck"),
  ];
  const inGameSnapshot = structuredClone(finalSnapshot);
  inGameSnapshot.room.phase = "in_game";
  inGameSnapshot.room.rawPhase = "tcga:in_game";

  replay.source.schema = "riftlite-tcga-raw-capture";
  replay.source.messageCount = 7;
  replay.series.games[0].eventEndIndex = 6;
  replay.series.games[0].phases = [
    {
      phase: "mulligan",
      rawPhase: "tcga:mulligan",
      startEventIndex: 1,
      endEventIndex: 4,
      startedAtMs: 100,
      endedAtMs: 400,
    },
    {
      phase: "in_game",
      rawPhase: "tcga:in_game",
      startEventIndex: 5,
      endEventIndex: 6,
      startedAtMs: 500,
      endedAtMs: 600,
    },
  ];
  replay.events = [
    replay.events[0],
    {
      id: "tcga-mulligan-phase",
      index: 1,
      at: 1_100,
      atMs: 100,
      sourceMessageId: "tcga-message-1",
      gameId: "game-1",
      kind: "phase",
      phase: "mulligan",
      rawPhase: "tcga:mulligan",
      gameNumber: 1,
    },
    {
      id: "tcga-opponent-hand-first",
      index: 2,
      at: 1_200,
      atMs: 200,
      sourceMessageId: "tcga-message-2",
      gameId: "game-1",
      kind: "snapshot",
      snapshot: earlySnapshot,
    },
    {
      id: "tcga-mulligan-log",
      index: 3,
      at: 1_300,
      atMs: 300,
      sourceMessageId: "tcga-message-3",
      gameId: "game-1",
      kind: "log",
      mode: "append",
      entries: [
        {
          id: "tcga-self-redraw",
          at: 1_300,
          text: "LeBlanc replaced 2 cards",
          authorPlayerId: "self",
          fields: { provider: "tcga", mulliganRedrawCount: 2 },
        },
        {
          id: "tcga-self-complete",
          at: 1_301,
          text: "LeBlanc completed a mulligan",
          authorPlayerId: "self",
          fields: { provider: "tcga", mulliganCompleted: true },
        },
      ],
    },
    {
      id: "tcga-perspective-hand-late",
      index: 4,
      at: 1_400,
      atMs: 400,
      sourceMessageId: "tcga-message-4",
      gameId: "game-1",
      kind: "snapshot",
      snapshot: finalSnapshot,
    },
    {
      id: "tcga-in-game-phase",
      index: 5,
      at: 1_500,
      atMs: 500,
      sourceMessageId: "tcga-message-5",
      gameId: "game-1",
      kind: "phase",
      phase: "in_game",
      rawPhase: "tcga:in_game",
      gameNumber: 1,
    },
    {
      id: "tcga-in-game-snapshot",
      index: 6,
      at: 1_600,
      atMs: 600,
      sourceMessageId: "tcga-message-6",
      gameId: "game-1",
      kind: "snapshot",
      snapshot: inGameSnapshot,
    },
  ];
  return replay;
}

function bo3SideboardingReplay(options: { includeResult: boolean }): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const sourceSnapshot = replay.events.find((event) => event.kind === "snapshot");
  if (!sourceSnapshot || sourceSnapshot.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its initial snapshot.");
  }
  const gameTwoSnapshot = structuredClone(sourceSnapshot.snapshot);
  gameTwoSnapshot.room.phase = "sideboarding";
  gameTwoSnapshot.room.rawPhase = "sideboarding";
  gameTwoSnapshot.room.gameNumber = 2;
  gameTwoSnapshot.room.firstPlayerId = "self";
  gameTwoSnapshot.players.self.fields = {
    ...gameTwoSnapshot.players.self.fields,
    submittedDeck: {
      sections: {
        mainDeck: [
          { cardCode: "OGN-001", count: 2, name: "Stable Card" },
          { cardCode: "OGN-010", count: 3, name: "Code Out" },
          { count: 1, name: "Name Only Out" },
        ],
        sideboard: [
          { cardCode: "OGN-020", count: 2, name: "Code In" },
          { count: 1, name: "Name Only In" },
        ],
      },
    },
  };
  const gameTwoRevealSnapshot = structuredClone(gameTwoSnapshot);
  gameTwoRevealSnapshot.room.phase = "in_game";
  gameTwoRevealSnapshot.room.rawPhase = "in_game";
  gameTwoRevealSnapshot.players.self.fields.selectedBattlefield = "Targon's Peak";
  gameTwoRevealSnapshot.players.opponent.fields.selectedBattlefield = "Star Spring";
  delete gameTwoRevealSnapshot.players.self.zones.battlefieldA;
  delete gameTwoRevealSnapshot.players.self.zones.battlefieldB;
  delete gameTwoRevealSnapshot.players.opponent.zones.battlefieldA;
  delete gameTwoRevealSnapshot.players.opponent.zones.battlefieldB;

  const gameOne = replay.series.games[0];
  gameOne.eventEndIndex = 2;
  if (options.includeResult) {
    gameOne.result = {
      resultEventId: "game-one-result",
      winnerPlayerId: "self",
      loserPlayerId: "opponent",
      finalScores: { self: 1, opponent: 0 },
    };
  } else {
    delete gameOne.result;
  }
  replay.series.format = "bo3";
  replay.series.bestOf = 3;
  replay.series.endedAt = 3_000;
  replay.series.games.push({
    id: "game-2",
    ordinal: 2,
    gameNumber: 2,
    sourceIdentity: { explicitGameNumber: true, gameInstanceIds: ["instance-2"] },
    startedAt: 2_000,
    endedAt: 3_000,
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    eventStartIndex: 3,
    eventEndIndex: 11,
    phases: [
      {
        phase: "sideboarding",
        rawPhase: "sideboarding",
        startEventIndex: 4,
        endEventIndex: 6,
        startedAtMs: 1_050,
        endedAtMs: 1_200,
      },
      {
        phase: "battlefield_pick",
        rawPhase: "battlefield_pick",
        startEventIndex: 8,
        endEventIndex: 8,
        startedAtMs: 1_400,
        endedAtMs: 1_400,
      },
      {
        phase: "first_player_choice",
        rawPhase: "first_player_choice",
        startEventIndex: 9,
        endEventIndex: 9,
        startedAtMs: 1_500,
        endedAtMs: 1_500,
      },
      {
        phase: "mulligan",
        rawPhase: "mulligan",
        startEventIndex: 10,
        endEventIndex: 10,
        startedAtMs: 1_600,
        endedAtMs: 1_600,
      },
      {
        phase: "in_game",
        rawPhase: "in_game",
        startEventIndex: 11,
        endEventIndex: 11,
        startedAtMs: 1_700,
        endedAtMs: 2_000,
      },
    ],
  });
  replay.source.endedAt = 3_000;
  replay.source.messageCount = 12;
  replay.events.push(
    {
      id: "game-two-boundary",
      index: 3,
      at: 2_000,
      atMs: 1_000,
      sourceMessageId: "message-game-two",
      gameId: "game-2",
      kind: "game_boundary",
      boundary: "start",
      gameOrdinal: 2,
      gameNumber: 2,
      reason: "explicit_game_number",
    },
    {
      id: "game-two-sideboard-phase",
      index: 4,
      at: 2_050,
      atMs: 1_050,
      sourceMessageId: "message-sideboard-phase",
      gameId: "game-2",
      kind: "phase",
      phase: "sideboarding",
      rawPhase: "sideboarding",
      gameNumber: 2,
    },
    {
      id: "game-two-snapshot",
      index: 5,
      at: 2_100,
      atMs: 1_100,
      sourceMessageId: "message-game-two-snapshot",
      gameId: "game-2",
      kind: "snapshot",
      snapshot: gameTwoSnapshot,
    },
    {
      id: "opponent-submit-sideboard",
      index: 6,
      at: 2_200,
      atMs: 1_200,
      sourceMessageId: "message-opponent-sideboard",
      gameId: "game-2",
      kind: "action",
      actionType: "submit_sideboard",
      actorPlayerId: "opponent",
      action: { type: "submit_sideboard" },
      confirmation: {
        status: "confirmed",
        authority: "authoritative_patch_commit",
        correlation: "matched_intent",
        commitMessageId: "message-opponent-sideboard",
      },
      patch: { sequence: 6, operations: [] },
    },
    {
      id: "self-submit-sideboard",
      index: 7,
      at: 2_300,
      atMs: 1_300,
      sourceMessageId: "message-self-sideboard",
      gameId: "game-2",
      kind: "action",
      actionType: "submit_sideboard",
      actorPlayerId: "self",
      action: {
        type: "submit_sideboard",
        mainDeck: [
          { cardCode: "OGN-001", count: 2, name: "Stable Card" },
          { cardCode: "OGN-010", count: 1, name: "Code Out" },
          { cardCode: "OGN-020", count: 2, name: "Code In" },
          { count: 1, name: "Name Only In" },
        ],
        sideboard: [
          { cardCode: "OGN-010", count: 2, name: "Code Out" },
          { count: 1, name: "Name Only Out" },
        ],
      },
      confirmation: {
        status: "confirmed",
        authority: "authoritative_patch_commit",
        correlation: "matched_intent",
        clientActionId: "self-sideboard-client-action",
        commitMessageId: "message-self-sideboard",
      },
      patch: { sequence: 7, operations: [] },
    },
    phaseEvent("battlefield_pick", 8, 2_400, 1_400),
    phaseEvent("first_player_choice", 9, 2_500, 1_500),
    phaseEvent("mulligan", 10, 2_600, 1_600),
    {
      id: "game-two-in-game-snapshot",
      index: 11,
      at: 2_700,
      atMs: 1_700,
      sourceMessageId: "message-in_game",
      gameId: "game-2",
      kind: "snapshot",
      snapshot: gameTwoRevealSnapshot,
    },
  );
  return replay;
}

function addOpponentSideboardDetails(replay: CanonicalReplayV2): void {
  const snapshot = replay.events.find((event) => event.id === "game-two-snapshot");
  const action = replay.events.find((event) => event.id === "opponent-submit-sideboard");
  if (!snapshot || snapshot.kind !== "snapshot" || !action || action.kind !== "action") {
    throw new Error("The replay fixture is missing opponent sideboard events.");
  }
  snapshot.snapshot.players.opponent.fields.submittedDeck = {
    sections: {
      mainDeck: [
        { cardCode: "OGN-001", count: 2, name: "Opponent Stable Card" },
        { cardCode: "OGN-030", count: 2, name: "Opponent Card Out" },
      ],
      sideboard: [
        { cardCode: "OGN-040", count: 1, name: "Opponent Card In" },
      ],
    },
  };
  action.action = {
    type: "submit_sideboard",
    mainDeck: [
      { cardCode: "OGN-001", count: 2, name: "Opponent Stable Card" },
      { cardCode: "OGN-030", count: 1, name: "Opponent Card Out" },
      { cardCode: "OGN-040", count: 1, name: "Opponent Card In" },
    ],
    sideboard: [
      { cardCode: "OGN-030", count: 1, name: "Opponent Card Out" },
    ],
  };
}

function addLegacyGameTwoCheckpoint(replay: CanonicalReplayV2) {
  const state = projectReplayState(replay, replay.series.games[0].eventEndIndex);
  state.gameId = "game-2";
  state.gameOrdinal = 2;
  state.phase = "battlefield_pick";
  state.room.phase = "battlefield_pick";
  state.room.rawPhase = "battlefield_pick";
  state.room.gameNumber = 2;
  state.room.firstPlayerId = "self";
  state.room.fields.selectedBattlefields = ["Windswept Hillock", "Sunken Temple"];
  state.players.self.fields.selectedBattlefield = "Windswept Hillock";
  state.players.self.fields.battlefieldOptions = ["Windswept Hillock", "Targon's Peak"];
  state.players.self.zones.battlefieldB = [replayCard("legacy-self-unit", "Black Rose Dignitary", "UNL-152", "mainDeck")];
  state.players.opponent.fields.selectedBattlefield = "Sunken Temple";
  state.players.opponent.fields.battlefieldOptions = ["Sunken Temple", "Star Spring"];
  state.players.opponent.zones.battlefieldA = [replayCard("legacy-opponent-unit", "Eager Drakehound", "SFD-006", "mainDeck")];
  state.appliedEventIndex = 7;
  replay.checkpoints = [{
    id: "legacy-game-two-checkpoint",
    eventIndex: 7,
    atMs: 1_300,
    stateHash: "legacy-stale-state",
    state,
  }];
}

function phaseEvent(
  phase: "battlefield_pick" | "first_player_choice" | "mulligan" | "in_game",
  index: number,
  at: number,
  atMs: number,
): CanonicalReplayV2["events"][number] {
  return {
    id: `game-two-${phase}`,
    index,
    at,
    atMs,
    sourceMessageId: `message-${phase}`,
    gameId: "game-2",
    kind: "phase",
    phase,
    rawPhase: phase,
    gameNumber: 2,
  };
}

function replayCard(id: string, name: string, cardCode: string, source: string) {
  return {
    id,
    name,
    cardCode,
    source,
    fields: { cardCode, name, source },
  };
}

function futureKnownAnalysisReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const snapshot = replay.events.find((event) => event.kind === "snapshot");
  if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");
  snapshot.snapshot.room.phase = "in_game";
  snapshot.snapshot.room.rawPhase = "in_game";
  snapshot.snapshot.room.turnNumber = 3;
  snapshot.snapshot.players.opponent.zones.hand = [hiddenCard("opponent-hand")];
  const revealed = replayCard("opponent-hand", "Eager Apprentice", "OGN-031", "base");
  replay.series.endedAt = 2_200;
  replay.series.games[0].endedAt = 2_200;
  replay.series.games[0].endedAtMs = 1_200;
  replay.series.games[0].eventEndIndex = 3;
  replay.events.push({
    id: "event-reveal-opponent-hand",
    index: 3,
    at: 2_000,
    atMs: 1_000,
    sourceMessageId: "message-reveal-opponent-hand",
    gameId: "game-1",
    kind: "action",
    actionType: "play_card",
    actorPlayerId: "opponent",
    action: { cardId: "opponent-hand" },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-reveal-opponent-hand",
    },
    patch: {
      sequence: 4,
      operations: [{
        id: "move-revealed-opponent-hand",
        op: "zone_move",
        cardId: "opponent-hand",
        from: { playerId: "opponent", zone: "hand" },
        to: { playerId: "opponent", zone: "base", index: 0 },
        card: revealed,
      }],
    },
  });
  return replay;
}

function previouslyKnownCardsUpReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const snapshot = replay.events.find((event) => event.kind === "snapshot");
  if (!snapshot || snapshot.kind !== "snapshot") throw new Error("Missing replay snapshot");
  snapshot.snapshot.room.phase = "in_game";
  snapshot.snapshot.room.rawPhase = "in_game";
  snapshot.snapshot.room.turnNumber = 3;
  const returned = replayCard("opponent-returned", "Stupefy", "OGN-212", "base");
  snapshot.snapshot.players.opponent.zones.base = [returned];
  replay.source.endedAt = 2_200;
  replay.source.messageCount = 4;
  replay.series.endedAt = 2_200;
  replay.series.games[0].endedAt = 2_200;
  replay.series.games[0].endedAtMs = 1_200;
  replay.series.games[0].eventEndIndex = 3;
  replay.events.push({
    id: "event-return-opponent-card",
    index: 3,
    at: 2_000,
    atMs: 1_000,
    sourceMessageId: "message-return-opponent-card",
    gameId: "game-1",
    kind: "action",
    actionType: "return_card",
    actorPlayerId: "opponent",
    action: { cardId: returned.id },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-return-opponent-card",
    },
    patch: {
      sequence: 4,
      operations: [{
        id: "move-returned-opponent-card",
        op: "zone_move",
        cardId: returned.id,
        from: { playerId: "opponent", zone: "base" },
        to: { playerId: "opponent", zone: "hand", index: 1 },
      }],
    },
  });
  return replay;
}

function technicalSteppingReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const action = (
    index: number,
    atMs: number,
    actionType: string,
  ): CanonicalReplayV2["events"][number] => ({
    id: `event-${actionType}-${index}`,
    index,
    at: 1_000 + atMs,
    atMs,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "action",
    actionType,
    action: { type: actionType },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "intent_not_observed",
      commitMessageId: `message-${index}`,
    },
    patch: { operations: [] },
  });
  const unknown = (
    index: number,
    atMs: number,
    packetType: string,
  ): CanonicalReplayV2["events"][number] => ({
    id: `event-${packetType}-${index}`,
    index,
    at: 1_000 + atMs,
    atMs,
    sourceMessageId: `message-${index}`,
    gameId: "game-1",
    kind: "unknown",
    packetType,
    reason: "unsupported_packet",
    payload: {},
  });

  replay.events.push(
    unknown(3, 100, "authoritative_patch_commit"),
    action(4, 200, "payment_batch"),
    unknown(5, 300, "rewind_confirmation_state"),
    action(6, 400, "move_card"),
    action(7, 500, "payment_batch"),
    unknown(8, 600, "authoritative_patch_commit"),
    action(9, 700, "end_turn"),
  );
  replay.series.games[0].eventEndIndex = replay.events.length - 1;
  return replay;
}

function cardMotionBookkeepingReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const phase = replay.events[1];
  const snapshot = replay.events[2];
  if (phase.kind !== "phase" || snapshot.kind !== "snapshot") {
    throw new Error("The replay fixture is missing its setup events.");
  }
  phase.phase = "in_game";
  phase.rawPhase = "in_game";
  snapshot.snapshot.room.phase = "in_game";
  snapshot.snapshot.room.rawPhase = "in_game";
  const movedCard = replayCard("self-hand", "Harnessed Dragon", "OGN-015", "mainDeck");

  replay.events.push(
    {
      id: "event-move-card",
      index: 3,
      at: 1_930,
      atMs: 930,
      sourceMessageId: "message-move-card",
      gameId: "game-1",
      kind: "action",
      actionType: "move_card",
      actorPlayerId: "self",
      action: { type: "move_card", cardId: movedCard.id },
      confirmation: {
        status: "confirmed",
        authority: "authoritative_patch_commit",
        correlation: "matched_intent",
        commitMessageId: "message-move-card",
      },
      patch: {
        sequence: 2,
        operations: [
          {
            id: "patch-move-card",
            op: "zone_move",
            cardId: movedCard.id,
            from: { playerId: "self", zone: "hand" },
            to: { playerId: "self", zone: "base", index: 0 },
            card: movedCard,
          },
          {
            id: "patch-zone-reorder",
            op: "unknown",
            sourceOp: "zone_reorder",
            payload: { op: "zone_reorder", playerId: "self", zone: "base" },
          },
        ],
      },
    },
    {
      id: "event-zone-reorder",
      index: 4,
      at: 1_930,
      atMs: 930,
      sourceMessageId: "message-move-card",
      gameId: "game-1",
      kind: "unknown",
      packetType: "authoritative_patch_commit",
      reason: "unknown_patch_operation",
      payload: {
        op: "unknown",
        sourceOp: "zone_reorder",
        payload: { op: "zone_reorder", playerId: "self", zone: "base" },
      },
    },
    {
      id: "event-rewind-confirmation",
      index: 5,
      at: 1_970,
      atMs: 970,
      sourceMessageId: "message-rewind-confirmation",
      gameId: "game-1",
      kind: "unknown",
      packetType: "rewind_confirmation_state",
      reason: "unsupported_packet",
      payload: { type: "rewind_confirmation_state", confirmation: null },
    },
  );
  replay.series.games[0].eventEndIndex = 5;
  replay.series.games[0].phases = [{
    phase: "in_game",
    rawPhase: "in_game",
    startEventIndex: 1,
    endEventIndex: 5,
    startedAtMs: 0,
    endedAtMs: 970,
  }];
  return replay;
}

function banishedTransitionReplay(): CanonicalReplayV2 {
  const replay = sideboardingAtZeroReplay();
  const banished = replayCard("self-banished", "Daring Poro", "OGN-135", "mainDeck");
  replay.series.endedAt = 2_200;
  replay.series.games[0].endedAt = 2_200;
  replay.series.games[0].endedAtMs = 1_200;
  replay.series.games[0].eventEndIndex = 3;
  replay.events.push({
    id: "event-banish-card",
    index: 3,
    at: 2_000,
    atMs: 1_000,
    sourceMessageId: "message-banish",
    gameId: "game-1",
    kind: "action",
    actionType: "banish_card",
    actorPlayerId: "self",
    action: { cardId: banished.id },
    confirmation: {
      status: "confirmed",
      authority: "authoritative_patch_commit",
      correlation: "matched_intent",
      commitMessageId: "message-banish",
    },
    patch: {
      sequence: 4,
      operations: [{
        id: "insert-banished-card",
        op: "zone_insert",
        playerId: "self",
        zone: "banished",
        index: 0,
        cards: [banished],
      }],
    },
  });
  return replay;
}

function motionRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function hiddenRune(id: string) {
  return {
    id,
    name: "Hidden rune",
    isPlaceholder: true,
    source: "runeDeck",
    fields: { isPlaceholder: true, source: "runeDeck" },
  };
}

function hiddenCard(id: string) {
  return {
    id,
    name: "Hidden card",
    isPlaceholder: true,
    source: "hand",
    fields: { isPlaceholder: true, source: "hand" },
  };
}
