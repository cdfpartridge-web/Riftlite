import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebaseHarness = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  listener: null as null | ((user: unknown) => void),
  signOut: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  getAuth: () => firebaseHarness.auth,
  GoogleAuthProvider: class GoogleAuthProvider {},
  onAuthStateChanged: (_auth: unknown, listener: (user: unknown) => void) => {
    firebaseHarness.listener = listener;
    listener(firebaseHarness.auth.currentUser);
    return () => undefined;
  },
  signOut: firebaseHarness.signOut,
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { HubInviteClient, type HubInviteSummary } from "./hub-invite-client";

const invite: HubInviteSummary = {
  inviteId: "abcdef0123456789",
  hubName: "Example Hub",
  senderName: "Example Admin",
  targetHandle: "",
  status: "open",
  expiresAt: Date.now() + 86_400_000,
  found: true,
};

describe("private hub invite confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseHarness.auth.currentUser = {
      uid: "browser-account",
      isAnonymous: false,
      email: "player@example.com",
      displayName: "Example Player",
      emailVerified: true,
      providerData: [{ providerId: "google.com" }],
      getIdToken: vi.fn(async () => "account-token"),
    };
    firebaseHarness.listener = null;
    firebaseHarness.signOut.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = null;
      firebaseHarness.listener?.(null);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])("does not consume an invite on load and handles alreadyMember=%s after explicit confirmation", async (alreadyMember) => {
    const fetchMock = mockFetch({ alreadyMember });
    const view = render(createElement(HubInviteClient, { invite }));
    await view.findByRole("heading", { name: "Join private hub?" });
    expect(view.getByText("Signed in as Example Player (@example)." )).toBeInTheDocument();
    expect(view.getByText("player@example.com")).toBeInTheDocument();
    expect(acceptCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Join private hub" }));
    await view.findByRole("heading", { name: "Your membership in Example Hub" });
    expect(acceptCalls(fetchMock)).toHaveLength(1);
    expect(acceptCalls(fetchMock)[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer account-token" },
      body: JSON.stringify({ inviteId: invite.inviteId }),
    });
    expect(view.getByText(alreadyMember
      ? "Your account is already a member of Example Hub. Open My Hubs to view it."
      : "You joined Example Hub. It will appear in RiftLite automatically after refresh.")).toBeInTheDocument();
  });

  it("allows switching an ambient browser account without consuming the invite", async () => {
    const fetchMock = mockFetch({});
    const view = render(createElement(HubInviteClient, { invite }));
    await view.findByRole("heading", { name: "Join private hub?" });
    fireEvent.click(view.getByRole("button", { name: "Use a different account" }));
    await view.findByRole("heading", { name: "Create or sign in" });
    expect(acceptCalls(fetchMock)).toHaveLength(0);
  });

  it("explains that an accepted single-use invite does not prove the viewer joined", async () => {
    const fetchMock = mockFetch({});
    const view = render(createElement(HubInviteClient, { invite: { ...invite, status: "accepted" } }));
    expect(view.getByText(/That does not mean your current account joined the hub/)).toBeInTheDocument();
    expect(view.getByText(/fresh invite addressed to your RiftLite handle/)).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Open My Hubs" })).toHaveAttribute("href", "/hubs");
    expect(view.queryByRole("button", { name: "Join private hub" })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});

function mockFetch(result: { alreadyMember?: boolean }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/account/profile") return Response.json({
      profile: { uid: "canonical-account", displayName: "Example Player", handle: "example", profileComplete: true },
    });
    if (String(input) === "/api/hubs/invites/accept" && init?.method === "POST") {
      return Response.json({ ok: true, hub: { name: "Example Hub" }, ...result });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function acceptCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/hubs/invites/accept");
}
