import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseHarness = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  listener: null as null | ((user: unknown) => void),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
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
  return { uid, displayName: "BMU", handle: "bmu", profileComplete: true };
}

function incompleteProfile(uid: string) {
  return { uid, displayName: "RiftLite Player", handle: "", profileComplete: false };
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
