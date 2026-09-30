import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

const { authPanel } = vi.hoisted(() => ({ authPanel: vi.fn() }));
vi.mock("@/components/site/riftlite-auth-panel", () => ({
  RiftLiteAuthPanel: authPanel,
}));

import { DiscordVerifyClient } from "@/components/site/discord-verify-client";

async function verificationMessage(payload: Record<string, unknown>) {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
  vi.stubGlobal("fetch", request);
  authPanel.mockReturnValue(null);
  render(createElement(DiscordVerifyClient, { code: "test-verification-code" }));
  const onReady = authPanel.mock.calls.at(-1)![0].onReady as (user: User) => Promise<{ message: string }>;
  const getIdToken = vi.fn().mockResolvedValue("synthetic-id-token");
  const result = await onReady({ getIdToken } as unknown as User);
  expect(getIdToken).toHaveBeenCalledWith(true);
  expect(request).toHaveBeenCalledWith("/api/discord/verify", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ code: "test-verification-code" }),
  }));
  return result.message;
}

describe("Discord verification membership feedback", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains the missing hub membership when no optional automatic role is configured", async () => {
    const message = await verificationMessage({
      roleAssigned: false, configuredRole: false, hubMembershipRequired: true, roleRequiresHubMembership: false,
    });
    expect(message).toContain("Discord verified.");
    expect(message).toContain("To use this server's hub commands");
    expect(message).toContain("same RiftLite account you used here");
    expect(message).toContain("fresh invitation");
    expect(message).not.toContain("role");
  });

  it("explains that a role is optional once membership is satisfied", async () => {
    const message = await verificationMessage({
      roleAssigned: false, configuredRole: false, hubMembershipRequired: false,
    });
    expect(message).toContain("role is optional");
    expect(message).not.toContain("invitation");
  });

  it.each([
    { configuredRole: true, hubMembershipRequired: true, roleRequiresHubMembership: true },
    { configuredRole: true, roleRequiresHubMembership: true },
  ])("keeps the role retry guidance for nonmembers and older API responses: %j", async (payload) => {
    const message = await verificationMessage(payload);
    expect(message).toContain("same RiftLite account you used here");
    expect(message).toContain("fresh invitation");
    expect(message).toContain("run /verify again to receive the testing role");
  });

  it("keeps successful role-assignment feedback", async () => {
    expect(await verificationMessage({ roleAssigned: true, configuredRole: true, hubMembershipRequired: false }))
      .toBe("Discord verified and your testing role was assigned.");
  });
});
