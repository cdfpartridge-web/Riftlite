import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebaseHarness = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  listener: null as null | ((user: unknown) => void),
  signOut: vi.fn(),
  signInWithPopup: vi.fn(),
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
  signInWithPopup: firebaseHarness.signInWithPopup,
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithCustomToken: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { TeamInviteClient } from "./team-invite-client";
import type { TeamInviteSummary } from "@/lib/team-invites";

const invite: TeamInviteSummary = {
  inviteId: "abcdef0123456789",
  teamName: "Example Team",
  senderName: "Example Admin",
  targetHandle: "",
  status: "open",
  expiresAt: Date.now() + 86_400_000,
  found: true,
};

function account() {
  return {
    uid: "browser-account", isAnonymous: false, email: "player@example.com", displayName: "Example Player",
    emailVerified: true, providerData: [{ providerId: "google.com" }],
    getIdToken: vi.fn(async () => "account-token"),
  };
}

describe("team invitation confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseHarness.auth.currentUser = account();
    firebaseHarness.listener = null;
    firebaseHarness.signOut.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = null;
      firebaseHarness.listener?.(null);
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("requires a deliberate Join team and reports alreadyMember=%s", async (alreadyMember) => {
    const fetchMock = mockFetch({ alreadyMember });
    const view = render(createElement(TeamInviteClient, { invite }));
    await view.findByRole("heading", { name: "Join team?" });
    expect(view.getByText("Signed in as Example Player (@example).")).toBeInTheDocument();
    expect(view.getByText("player@example.com")).toBeInTheDocument();
    expect(acceptCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await view.findByRole("heading", { name: "Your membership in Example Team" });
    expect(acceptCalls(fetchMock)).toHaveLength(1);
    expect(acceptCalls(fetchMock)[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer account-token" },
      body: JSON.stringify({ inviteId: invite.inviteId }),
    });
    expect(view.getByText(alreadyMember
      ? "Your account is already a member of Example Team. Open My Teams to view it."
      : "You joined Example Team. Open My Teams to view your membership.")).toBeInTheDocument();
    for (const link of view.getAllByRole("link", { name: "Open My Teams" })) {
      expect(link).toHaveAttribute("href", "/account/teams");
    }
    expect(view.queryByRole("link", { name: "Open My Hubs" })).not.toBeInTheDocument();
  });

  it("still requires Join team after a fresh Google sign-in", async () => {
    firebaseHarness.auth.currentUser = null;
    firebaseHarness.signInWithPopup.mockImplementation(async () => {
      const user = account();
      firebaseHarness.auth.currentUser = user;
      firebaseHarness.listener?.(user);
      return { user };
    });
    const fetchMock = mockFetch({});
    const view = render(createElement(TeamInviteClient, { invite }));
    fireEvent.click(view.getByRole("button", { name: "Continue with Google" }));
    await view.findByRole("heading", { name: "Join team?" });
    expect(acceptCalls(fetchMock)).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await view.findByRole("heading", { name: "Your membership in Example Team" });
    expect(acceptCalls(fetchMock)).toHaveLength(1);
  });

  it("shows a wrong-account refusal and allows switching accounts without a second acceptance", async () => {
    const fetchMock = mockFetch({ error: "This invite is reserved for another RiftLite account." }, 403);
    const view = render(createElement(TeamInviteClient, { invite: { ...invite, targetHandle: "teammate" } }));
    await view.findByRole("heading", { name: "Join team?" });
    expect(view.getByText("Reserved for @teammate")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await view.findByText("This invite is reserved for another RiftLite account.");
    expect(view.queryByRole("heading", { name: "Your membership in Example Team" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Use a different account" }));
    await view.findByRole("heading", { name: "Create or sign in" });
    expect(acceptCalls(fetchMock)).toHaveLength(1);
  });

  it("explains that an accepted invite does not prove the viewer joined", () => {
    const fetchMock = mockFetch({});
    const view = render(createElement(TeamInviteClient, { invite: { ...invite, status: "accepted" } }));
    expect(view.getByText(/That does not mean your current account joined the team/)).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Open My Teams" })).toHaveAttribute("href", "/account/teams");
    expect(view.queryByRole("button", { name: "Join team" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { update: { expiresAt: Date.now() - 60_000 }, message: /This invite expired/ },
    { update: { status: "revoked" }, message: /This invite is no longer available/ },
    { update: { found: false }, message: /Ask a team owner or admin to create a new invite/ },
  ])("does not show sign-in or acceptance for an unavailable invitation: %j", ({ update, message }) => {
    const fetchMock = mockFetch({});
    const view = render(createElement(TeamInviteClient, { invite: { ...invite, ...update } }));
    expect(view.getByText(message)).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Join team" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function mockFetch(result: { alreadyMember?: boolean; error?: string }, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/account/profile") return Response.json({
      profile: { uid: "canonical-account", displayName: "Example Player", handle: "example", profileComplete: true },
    });
    if (String(input) === "/api/teams/invites/accept" && init?.method === "POST") {
      return Response.json({ ok: status === 200, team: { id: "private-team-id", name: "Example Team", slug: "private-team", role: "member" }, ...result }, { status });
    }
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function acceptCalls(fetchMock: ReturnType<typeof mockFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === "/api/teams/invites/accept");
}
