import { createElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseHarness = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  listener: null as null | ((user: unknown) => void),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: firebaseHarness.createUserWithEmailAndPassword,
  getAuth: () => firebaseHarness.auth,
  GoogleAuthProvider: class GoogleAuthProvider {},
  onAuthStateChanged: (_auth: unknown, listener: (user: unknown) => void) => {
    firebaseHarness.listener = listener;
    listener(firebaseHarness.auth.currentUser);
    return () => undefined;
  },
  sendEmailVerification: firebaseHarness.sendEmailVerification,
  sendPasswordResetEmail: firebaseHarness.sendPasswordResetEmail,
  signInWithEmailAndPassword: firebaseHarness.signInWithEmailAndPassword,
  signInWithCustomToken: firebaseHarness.signInWithCustomToken,
  signInWithPopup: firebaseHarness.signInWithPopup,
  signOut: firebaseHarness.signOut,
}));

vi.mock("@/lib/firebase/client", () => ({ firebaseClientApp: {} }));

import { RiftLiteAuthPanel } from "./riftlite-auth-panel";

type TestUser = {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  providerData: Array<{ providerId: string }>;
  getIdToken: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
};

const desktopLink = { sessionId: "session-1", code: "ABC123" };

describe("RiftLite desktop account sign in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseHarness.auth.currentUser = null;
    firebaseHarness.listener = null;

    firebaseHarness.signOut.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = null;
      firebaseHarness.listener?.(null);
    });
    firebaseHarness.sendEmailVerification.mockResolvedValue(undefined);
  });

  it("keeps an ambient signed-in browser account behind exact confirmation", async () => {
    const account = testUser("website-account-1");
    firebaseHarness.auth.currentUser = account;
    mockProfileFetch(completeProfile(account.uid));
    const onReady = vi.fn(async () => ({ message: "Linked." }));

    const view = render(createElement(RiftLiteAuthPanel, {
      actionLabel: "Finish linking",
      desktopLink,
      onReady,
      readyTitle: "RiftLite is linked",
    }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Link this desktop account?" })).toBeInTheDocument();
    });
    expect(view.getByText(/BMU \(@bmu\)/)).toBeInTheDocument();
    expect(view.getByText(/websit\.\.\.nt-1/)).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Link this desktop as @bmu" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("auto-completes a fresh Google selection once", async () => {
    const account = testUser("google-account-1", false, { emailVerified: false, providerId: "google.com" });
    const fetchMock = mockProfileFetch(completeProfile(account.uid));
    firebaseHarness.signInWithPopup.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));

    const view = render(createElement(RiftLiteAuthPanel, {
      actionLabel: "Finish linking",
      desktopLink,
      onReady,
      preferredProvider: "google",
      readyTitle: "RiftLite is linked",
    }));

    const googleButton = view.getByRole("button", { name: "Continue with Google" });
    expect(googleButton).toHaveFocus();
    fireEvent.click(googleButton);

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "RiftLite is linked" })).toBeInTheDocument();
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(firebaseHarness.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/auth/link/bootstrap"))).toBe(false);
    expect(view.queryByRole("heading", { name: "Link this desktop account?" })).not.toBeInTheDocument();
  });

  it("requires the opted-in action confirmation even after a fresh sign-in and profile save", async () => {
    const account = testUser("new-hub-account");
    let profile = incompleteProfile(account.uid);
    mockProfileFetch(() => profile, () => {
      profile = completeProfile(account.uid);
      return profile;
    });
    firebaseHarness.signInWithPopup.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const onReady = vi.fn(async () => ({ message: "Joined." }));
    const view = render(createElement(RiftLiteAuthPanel, {
      actionLabel: "Join private hub",
      requireActionConfirmation: true,
      onReady,
    }));
    fireEvent.click(view.getByRole("button", { name: "Continue with Google" }));
    await view.findByRole("heading", { name: "Choose your RiftLite name" });
    fireEvent.change(view.getByPlaceholderText("Name other players will see"), { target: { value: "BMU" } });
    fireEvent.change(view.getByPlaceholderText("your-handle"), { target: { value: "bmu" } });
    fireEvent.click(view.getByRole("button", { name: "Save profile" }));

    await view.findByRole("heading", { name: "Join private hub?" });
    expect(onReady).not.toHaveBeenCalled();
    expect(view.getByText(/Signed in as BMU \(@bmu\)/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Join private hub" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it.each(["success", "failure"])("ignores stale action %s after an external account switch without clearing the new action", async (outcome) => {
    const first = testUser("first-account");
    const second = testUser("second-account");
    firebaseHarness.auth.currentUser = first;
    mockProfileFetch(() => ({
      ...completeProfile((firebaseHarness.auth.currentUser as TestUser).uid),
      displayName: (firebaseHarness.auth.currentUser as TestUser).uid === first.uid ? "First Player" : "Second Player",
    }));
    const previous = deferred<{ message: string }>();
    const current = deferred<{ message: string }>();
    const onReady = vi.fn((activeUser: { uid: string }) => activeUser.uid === first.uid ? previous.promise : current.promise);
    const view = render(createElement(RiftLiteAuthPanel, {
      actionLabel: "Join team", requireActionConfirmation: true, onReady, readyTitle: "Team membership confirmed",
    }));
    await view.findByRole("heading", { name: "Join team?" });
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    expect(view.getByRole("button", { name: "Use a different account" })).toBeDisabled();
    await act(async () => {
      firebaseHarness.auth.currentUser = second;
      firebaseHarness.listener?.(second);
    });
    await view.findByText("Signed in as Second Player (@bmu).");
    expect(view.getByRole("button", { name: "Join team" })).toBeEnabled();
    expect(view.queryByText("Join team...")).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await act(async () => {
      if (outcome === "success") previous.resolve({ message: "First Player joined." });
      else previous.reject(new Error("First Player request failed."));
    });
    expect(view.queryByText("First Player joined.")).not.toBeInTheDocument();
    expect(view.queryByText("First Player request failed.")).not.toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Team membership confirmed" })).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Join team..." })).toBeDisabled();
    expect(view.getByRole("button", { name: "Use a different account" })).toBeDisabled();
    await act(async () => current.resolve({ message: "Second Player joined." }));
    await view.findByRole("heading", { name: "Team membership confirmed" });
    expect(view.getByText("Second Player joined.")).toBeInTheDocument();
    expect(onReady).toHaveBeenCalledTimes(2);
  });

  it("does not reuse an old action completion after signing out and back into the same account", async () => {
    const account = testUser("returning-account");
    firebaseHarness.auth.currentUser = account;
    mockProfileFetch(completeProfile(account.uid));
    const previous = deferred<{ message: string }>();
    const onReady = vi.fn(() => previous.promise);
    const view = render(createElement(RiftLiteAuthPanel, { actionLabel: "Join team", requireActionConfirmation: true, onReady }));
    await view.findByRole("heading", { name: "Join team?" });
    fireEvent.click(view.getByRole("button", { name: "Join team" }));
    await act(async () => {
      firebaseHarness.auth.currentUser = null;
      firebaseHarness.listener?.(null);
    });
    await view.findByRole("heading", { name: "Create or sign in" });
    await act(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
    });
    await view.findByRole("heading", { name: "Join team?" });
    await act(async () => previous.resolve({ message: "Old action completed." }));
    expect(view.queryByText("Old action completed.")).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Join team" })).toBeEnabled();
  });

  it("keeps automatic completion for existing non-desktop flows unless confirmation is requested", async () => {
    const account = testUser("automatic-flow-account");
    firebaseHarness.auth.currentUser = account;
    mockProfileFetch(completeProfile(account.uid));
    const onReady = vi.fn(async () => ({ message: "Verified." }));
    render(createElement(RiftLiteAuthPanel, { actionLabel: "Verify Discord", onReady }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("expands hinted email sign-in and auto-completes after a new profile is saved", async () => {
    const account = testUser("email-account-1", false, { emailVerified: true, providerId: "password" });
    let profile = incompleteProfile(account.uid);
    const fetchMock = mockProfileFetch(() => profile, () => {
      profile = completeProfile(account.uid);
      return profile;
    });
    firebaseHarness.signInWithEmailAndPassword.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));

    const view = render(createElement(RiftLiteAuthPanel, {
      actionLabel: "Finish linking",
      desktopLink,
      onReady,
      preferredProvider: "email",
      readyTitle: "RiftLite is linked",
    }));

    const emailInput = view.getByPlaceholderText("Email address");
    expect(emailInput).toHaveFocus();
    fireEvent.change(emailInput, { target: { value: "player@example.com" } });
    fireEvent.change(view.getByPlaceholderText("Password"), { target: { value: "test-password" } });
    fireEvent.click(view.getByRole("button", { name: "Sign in with email" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Choose your RiftLite name" })).toBeInTheDocument();
    });
    expect(onReady).not.toHaveBeenCalled();

    fireEvent.change(view.getByPlaceholderText("Name other players will see"), { target: { value: "BMU" } });
    fireEvent.change(view.getByPlaceholderText("your-handle"), { target: { value: "bmu" } });
    fireEvent.click(view.getByRole("button", { name: "Finish linking" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "RiftLite is linked" })).toBeInTheDocument();
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(firebaseHarness.signInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(firebaseHarness.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/auth/link/bootstrap"))).toBe(false);
  });

  it("allows Google sign-in to be retried after the popup is cancelled", async () => {
    const account = testUser("google-retry-account");
    mockProfileFetch(completeProfile(account.uid));
    firebaseHarness.signInWithPopup
      .mockRejectedValueOnce(new Error("Firebase: Error (auth/popup-closed-by-user)."))
      .mockImplementationOnce(async () => {
        firebaseHarness.auth.currentUser = account;
        firebaseHarness.listener?.(account);
        return { user: account };
      });
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));

    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      onReady,
      preferredProvider: "google",
      readyTitle: "RiftLite is linked",
    }));

    fireEvent.click(view.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => {
      expect(view.getByText("Google sign in was closed before it finished.")).toBeInTheDocument();
    });

    const retryButton = view.getByRole("button", { name: "Continue with Google" });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it("offers Discord sign-up and sign-in for a desktop link", () => {
    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      preferredProvider: "discord",
    }));

    const link = view.getByRole("link", { name: "Continue with Discord" });
    expect(link).toHaveAttribute("href", "/api/auth/discord/start?session=session-1&code=ABC123");
    expect(view.getByText(/Discord can create your RiftLite account/i)).toBeInTheDocument();
    expect(firebaseHarness.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("offers public Discord sign-up with a local return destination", () => {
    window.history.replaceState({}, "", "/hubs");
    const view = render(createElement(RiftLiteAuthPanel));
    expect(view.getByRole("link", { name: "Continue with Discord" })).toHaveAttribute("href", "/api/auth/discord/start?returnTo=%2Fhubs");
    window.history.replaceState({}, "", "/");
  });

  it("requires a new Discord account to choose a profile before completing desktop linking", async () => {
    const account = testUser("new-discord-account", false, { providerId: "custom" });
    let profile = incompleteProfile(account.uid);
    firebaseHarness.signInWithCustomToken.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/discord/token") return jsonResponse({ customToken: "discord-token", uid: account.uid });
      if (String(input) === "/api/account/profile") {
        if (init?.method === "PATCH") profile = completeProfile(account.uid);
        return jsonResponse({ profile });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", requests);
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));
    const view = render(createElement(RiftLiteAuthPanel, { desktopLink, discordCompletion: true, onReady, actionLabel: "Save profile" }));
    await view.findByRole("heading", { name: "Choose your RiftLite name" });
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.change(view.getByPlaceholderText("Name other players will see"), { target: { value: "BMU" } });
    fireEvent.change(view.getByPlaceholderText("your-handle"), { target: { value: "bmu" } });
    fireEvent.click(view.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const patch = requests.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(patch?.body))).toEqual({ displayName: "BMU", handle: "bmu" });
  });

  it("never links an ambient browser account while exchanging the selected Discord identity", async () => {
    const ambient = testUser("ambient-google-account");
    const discord = testUser("chosen-discord-account", false, { providerId: "custom" });
    firebaseHarness.auth.currentUser = ambient;
    let finishToken!: (value: Response) => void;
    const token = new Promise<Response>((resolve) => { finishToken = resolve; });
    firebaseHarness.signInWithCustomToken.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = discord;
      firebaseHarness.listener?.(discord);
      return { user: discord };
    });
    const requests = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/discord/token") return token;
      if (String(input) === "/api/account/profile") return jsonResponse({ profile: completeProfile(discord.uid) });
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", requests);
    const onReady = vi.fn(async () => ({ message: "Linked." }));
    render(createElement(RiftLiteAuthPanel, { desktopLink, discordCompletion: true, onReady }));
    await act(async () => { await Promise.resolve(); });
    expect(onReady).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalledWith("/api/account/profile", expect.anything());
    await act(async () => finishToken(jsonResponse({ customToken: "discord-token", uid: discord.uid })));
    await waitFor(() => expect(onReady).toHaveBeenCalledExactlyOnceWith(discord));
  });

  it("completes public Discord sign-up through the same profile flow", async () => {
    const account = testUser("public-discord-account", false, { providerId: "custom" });
    firebaseHarness.signInWithCustomToken.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/auth/discord/token"
      ? jsonResponse({ customToken: "discord-token", uid: account.uid })
      : jsonResponse({ profile: completeProfile(account.uid) })));
    const view = render(createElement(RiftLiteAuthPanel, { discordCompletion: true, completionLink: { href: "/hubs", label: "Continue" } }));
    await view.findByRole("heading", { name: "Your account is ready" });
    expect(view.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/hubs");
  });

  it("does not let a stale Discord profile failure clear another account's pending action", async () => {
    const discord = testUser("discord-first", false, { providerId: "custom" });
    const other = testUser("other-account");
    const oldProfile = deferred<Response>();
    const currentAction = deferred<{ message: string }>();
    firebaseHarness.signInWithCustomToken.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = discord;
      firebaseHarness.listener?.(discord);
      return { user: discord };
    });
    const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/discord/token") return jsonResponse({ customToken: "discord-token" });
      if (new Headers(init?.headers).get("Authorization") === "Bearer token-discord-first") return oldProfile.promise;
      return jsonResponse({ profile: completeProfile(other.uid) });
    });
    vi.stubGlobal("fetch", requests);
    const onReady = vi.fn(() => currentAction.promise);
    const view = render(createElement(RiftLiteAuthPanel, { desktopLink, discordCompletion: true, onReady }));
    await waitFor(() => expect(requests).toHaveBeenCalledWith("/api/account/profile", expect.anything()));
    await act(async () => {
      firebaseHarness.auth.currentUser = other;
      firebaseHarness.listener?.(other);
    });
    fireEvent.click(await view.findByRole("button", { name: "Link this desktop as @bmu" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledExactlyOnceWith(other));
    await act(async () => oldProfile.reject(new Error("Old Discord request failed")));
    expect(view.queryByText("Old Discord request failed")).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Continue..." })).toBeDisabled();
    await act(async () => currentAction.resolve({ message: "Current account linked." }));
    await view.findByText("Current account linked.");
  });

  it("exchanges a completed Discord proof and loads the existing account", async () => {
    const account = testUser("legacy-discord-account", false, { providerId: "custom" });
    firebaseHarness.signInWithCustomToken.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/discord/token") {
        return jsonResponse({ customToken: "discord-custom-token", uid: account.uid });
      }
      if (String(input) === "/api/account/profile") {
        return jsonResponse({ profile: completeProfile(account.uid) });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));

    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      discordCompletion: true,
      onReady,
      preferredProvider: "discord",
      readyTitle: "RiftLite is linked",
    }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(firebaseHarness.signInWithCustomToken).toHaveBeenCalledWith(
      firebaseHarness.auth,
      "discord-custom-token",
    );
    expect(view.getByRole("heading", { name: "RiftLite is linked" })).toBeInTheDocument();
  });

  it("creates an email account directly and blocks desktop linking until verification", async () => {
    const account = testUser("new-email-account", false, { emailVerified: false, providerId: "password" });
    const fetchMock = mockProfileFetch(completeProfile(account.uid));
    firebaseHarness.createUserWithEmailAndPassword.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const onReady = vi.fn(async () => ({ message: "Desktop connected." }));
    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      onReady,
      preferredProvider: "email",
      readyTitle: "RiftLite is linked",
    }));

    fireEvent.change(view.getByPlaceholderText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.change(view.getByPlaceholderText("Password"), { target: { value: "test-password" } });
    fireEvent.click(view.getByRole("button", { name: "Create with email" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    });
    expect(firebaseHarness.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(firebaseHarness.sendEmailVerification).toHaveBeenCalledWith(account);
    expect(firebaseHarness.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    account.emailVerified = true;
    fireEvent.click(view.getByRole("button", { name: "I've verified my email" }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(account.reload).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/auth/link/bootstrap"))).toBe(false);
  });

  it("keeps resend available after an existing unverified account signs in", async () => {
    const account = testUser("existing-unverified-account", false, {
      emailVerified: false,
      providerId: "password",
    });
    firebaseHarness.signInWithEmailAndPassword.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      preferredProvider: "email",
    }));

    fireEvent.change(view.getByPlaceholderText("Email address"), { target: { value: "player@example.com" } });
    fireEvent.change(view.getByPlaceholderText("Password"), { target: { value: "test-password" } });
    fireEvent.click(view.getByRole("button", { name: "Sign in with email" }));

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    });
    const resend = view.getByRole("button", { name: "Send verification email again" });
    expect(resend).toBeEnabled();
    expect(firebaseHarness.sendEmailVerification).not.toHaveBeenCalled();

    fireEvent.click(resend);
    await waitFor(() => expect(firebaseHarness.sendEmailVerification).toHaveBeenCalledWith(account));
    expect(await view.findByRole("status")).toHaveTextContent(
      "Verification email sent to player@example.com.",
    );
    expect(view.getByRole("button", { name: "Send verification email again" })).toBeEnabled();
  });

  it("labels a pending first verification email and leaves account switching available", async () => {
    const account = testUser("pending-verification-account", false, {
      emailVerified: false,
      providerId: "password",
    });
    let finishSend: (() => void) | undefined;
    firebaseHarness.sendEmailVerification.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSend = resolve;
    }));
    firebaseHarness.createUserWithEmailAndPassword.mockImplementation(async () => {
      firebaseHarness.auth.currentUser = account;
      firebaseHarness.listener?.(account);
      return { user: account };
    });
    const view = render(createElement(RiftLiteAuthPanel, {
      desktopLink,
      preferredProvider: "email",
    }));

    fireEvent.change(view.getByPlaceholderText("Email address"), { target: { value: "player@example.com" } });
    fireEvent.change(view.getByPlaceholderText("Password"), { target: { value: "test-password" } });
    fireEvent.click(view.getByRole("button", { name: "Create with email" }));

    const sending = await view.findByRole("button", { name: "Sending verification email..." });
    expect(sending).toBeDisabled();
    expect(view.getByRole("button", { name: "Use a different account" })).toBeEnabled();

    finishSend?.();
    await waitFor(() => {
      expect(view.getByRole("button", { name: "Send verification email again" })).toBeEnabled();
    });
  });

  it("re-enables resend with a clear message after Firebase throttles it", async () => {
    const account = testUser("throttled-verification-account", false, {
      emailVerified: false,
      providerId: "password",
    });
    firebaseHarness.auth.currentUser = account;
    firebaseHarness.sendEmailVerification.mockRejectedValueOnce(
      new Error("Firebase: Error (auth/too-many-requests)."),
    );
    const view = render(createElement(RiftLiteAuthPanel, { desktopLink }));

    const resend = await view.findByRole("button", { name: "Send verification email again" });
    fireEvent.click(resend);

    await waitFor(() => {
      expect(view.getByRole("status")).toHaveTextContent(
        "Too many verification emails were requested. Wait a few minutes, then try again.",
      );
    });
    expect(view.getByRole("button", { name: "Send verification email again" })).toBeEnabled();
  });

  it("shows the canonical profile account ID in confirmation and account management", async () => {
    const account = testUser("desktop-alias-123456");
    const canonicalProfile = completeProfile("canonical-account-987654");
    firebaseHarness.auth.currentUser = account;
    mockProfileFetch(canonicalProfile);

    const confirmation = render(createElement(RiftLiteAuthPanel, { desktopLink }));
    await waitFor(() => {
      expect(confirmation.getByRole("heading", { name: "Link this desktop account?" })).toBeInTheDocument();
    });
    expect(confirmation.getByText(/canoni\.\.\.7654/)).toBeInTheDocument();
    expect(confirmation.queryByText(/deskto\.\.\.3456/)).not.toBeInTheDocument();
    confirmation.unmount();

    firebaseHarness.listener = null;
    const management = render(createElement(RiftLiteAuthPanel, { manageAccount: true }));
    await waitFor(() => {
      expect(management.getByRole("heading", { name: "Your RiftLite account" })).toBeInTheDocument();
    });
    expect(management.getByText(/canoni\.\.\.7654/)).toBeInTheDocument();
    expect(management.queryByText(/deskto\.\.\.3456/)).not.toBeInTheDocument();
  });

  it("makes public profile visibility and the direct profile link manageable on the website", async () => {
    const account = testUser("public-profile-account");
    const profile = {
      ...completeProfile(account.uid),
      publicProfile: true,
      searchable: true,
      showStats: true,
      showMatches: true,
      showDecks: true,
    };
    firebaseHarness.auth.currentUser = account;
    const fetchMock = mockProfileFetch(profile);

    const view = render(createElement(RiftLiteAuthPanel, { manageAccount: true }));
    await waitFor(() => {
      expect(view.getByRole("heading", { name: "Public player profile" })).toBeInTheDocument();
    });
    expect(view.getByRole("link", { name: "Open public profile" })).toHaveAttribute("href", "/user/bmu");
    expect(view.getByRole("checkbox", { name: "Publish my profile" })).toBeChecked();
    expect(view.getByRole("checkbox", { name: "Appear in player search" })).toBeChecked();

    fireEvent.click(view.getByRole("checkbox", { name: "Show public deck details" }));
    fireEvent.click(view.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => {
        if (init?.method !== "PATCH") return false;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return body.publicProfile === true && body.searchable === true && body.showDecks === false;
      })).toBe(true);
    });
  });
});

function testUser(
  uid: string,
  isAnonymous = false,
  options: { emailVerified?: boolean; providerId?: string } = {},
): TestUser {
  return {
    uid,
    isAnonymous,
    email: isAnonymous ? null : "player@example.com",
    displayName: isAnonymous ? null : "BMU",
    emailVerified: isAnonymous ? false : options.emailVerified ?? true,
    providerData: isAnonymous ? [] : [{ providerId: options.providerId ?? "google.com" }],
    getIdToken: vi.fn(async () => `token-${uid}`),
    reload: vi.fn(async () => undefined),
  };
}

function completeProfile(uid: string) {
  return {
    uid,
    displayName: "BMU",
    handle: "bmu",
    profileComplete: true,
    publicProfile: false,
    searchable: false,
    showStats: true,
    showMatches: true,
    showDecks: true,
  };
}

function incompleteProfile(uid: string) {
  return {
    uid,
    displayName: "RiftLite Player",
    handle: "",
    profileComplete: false,
    publicProfile: false,
    searchable: false,
    showStats: true,
    showMatches: true,
    showDecks: true,
  };
}

function mockProfileFetch(
  readProfile: ReturnType<typeof completeProfile> | (() => ReturnType<typeof completeProfile>),
  saveProfile?: () => ReturnType<typeof completeProfile>,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/account/profile") {
      const profile = init?.method === "PATCH" && saveProfile
        ? saveProfile()
        : typeof readProfile === "function"
          ? readProfile()
          : readProfile;
      return jsonResponse({ profile });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
