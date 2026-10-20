import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewAccountControls } from "./ReviewAccountControls";
import type { useReplayAccountReview } from "./useReplayAccountReview";

function expiredAccount(): ReturnType<typeof useReplayAccountReview> {
  return {
    status: "expired", accountId: "alice", review: null, saving: false, error: "Expired", conflict: null,
    pendingNotes: null, hasPendingChanges: true, notes: [], boundaryKey: "alice:replay", sessionKey: 1,
    saveReview: vi.fn(async () => false), saveNotes: vi.fn(async () => false), refresh: vi.fn(async () => false),
    reloadLatest: vi.fn(async () => false), retryDraft: vi.fn(async () => false),
  };
}

describe("expired review session recovery", () => {
  it("keeps the desktop tab open and checks reconnection without exposing guest or save actions", () => {
    const account = expiredAccount();
    const view = render(createElement(ReviewAccountControls, { account, embedded: true, onResolved: vi.fn() }));
    expect(view.getByRole("alert")).toHaveTextContent("account session expired");
    expect(view.getByText(/Keep it open while reconnecting/)).toBeInTheDocument();
    expect(view.getByText(/Reconnect your account from RiftLite/)).toBeInTheDocument();
    expect(view.queryByRole("link")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Save to my reviews" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Check account connection" }));
    expect(account.refresh).toHaveBeenCalledOnce();
    expect(account.saveReview).not.toHaveBeenCalled();
  });

  it("offers website reauthentication in a separate tab while preserving the draft tab", () => {
    const view = render(createElement(ReviewAccountControls, { account: expiredAccount(), embedded: false, onResolved: vi.fn() }));
    const link = view.getByRole("link", { name: "Sign in again" });
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(view.getByText(/Sign in to the same account/)).toBeInTheDocument();
  });
});
