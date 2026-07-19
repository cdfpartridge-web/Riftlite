import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/site/riftlite-auth-panel", () => ({
  RiftLiteAuthPanel: () => createElement("div", { "data-testid": "auth-panel" }),
}));

import { AccountLinkClient } from "@/components/site/account-link-client";

describe("desktop-link URL privacy", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("removes the session, code, and provider query immediately after mounting", async () => {
    window.history.replaceState({}, "", "/link-device?session=session-secret&code=ABC123&provider=email");

    render(createElement(AccountLinkClient, {
      sessionId: "session-secret",
      code: "ABC123",
      preferredProvider: "email",
    }));

    await waitFor(() => expect(window.location.href).toMatch(/\/link-device$/));
    expect(window.location.search).toBe("");
  });
});
