"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  accountIdHint,
  accountIdentityLabel,
  shouldAutomaticallyFinishAccountAction,
} from "@/lib/account-link";
import { firebaseClientApp } from "@/lib/firebase/client";

type Profile = {
  uid: string;
  displayName: string;
  handle: string;
  profileComplete: boolean;
};

type DesktopLink = { sessionId: string; code: string };
export type AuthProviderHint = "google" | "email";

export type RiftLiteReadyResult = { message?: string } | void;

export function RiftLiteAuthPanel({
  desktopLink,
  onReady,
  actionLabel = "Continue",
  readyTitle = "Your account is ready",
  description = "Use one RiftLite account for the app, private hubs, Discord, and web replays.",
  manageAccount = false,
  preferredProvider,
}: {
  desktopLink?: DesktopLink;
  onReady?: (user: User) => Promise<RiftLiteReadyResult>;
  actionLabel?: string;
  readyTitle?: string;
  description?: string;
  manageAccount?: boolean;
  preferredProvider?: AuthProviderHint;
}) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [emailExpanded, setEmailExpanded] = useState(preferredProvider === "email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const [verificationUser, setVerificationUser] = useState<User | null>(null);
  const actionUid = useRef("");
  const explicitAuthPending = useRef(false);
  const explicitAuthProvider = useRef<AuthProviderHint | null>(null);
  const explicitlySelectedUid = useRef("");
  const observedAuthKey = useRef("");

  const requiresDesktopEmailVerification = useCallback((activeUser: User) => {
    if (!desktopLink || activeUser.emailVerified) return false;
    if (
      explicitlySelectedUid.current === activeUser.uid ||
      explicitAuthPending.current
    ) {
      return explicitAuthProvider.current === "email";
    }
    const providers = new Set(activeUser.providerData.map((provider) => provider.providerId));
    return providers.has("password") && !providers.has("google.com");
  }, [desktopLink]);

  const loadProfile = useCallback(async (activeUser: User) => {
    if (activeUser.isAnonymous) return null;
    const token = await activeUser.getIdToken(true);
    const response = await fetch("/api/account/profile", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await response.json() as { profile?: Profile; error?: string };
    if (!response.ok || !payload.profile) throw new Error(payload.error ?? "Could not load your RiftLite profile.");
    setProfile(payload.profile);
    setDisplayName(isGeneratedName(payload.profile.displayName) ? activeUser.displayName ?? "" : payload.profile.displayName);
    setHandle(payload.profile.handle);
    setHandleEdited(Boolean(payload.profile.handle));
    return payload.profile;
  }, []);

  const finishAction = useCallback(async (activeUser: User, activeProfile: Profile) => {
    if (!activeProfile.profileComplete || actionUid.current === activeUser.uid) return;
    if (manageAccount) return;
    if (requiresDesktopEmailVerification(activeUser)) {
      setVerificationUser(activeUser);
      setMessage("Verify your email before linking this desktop.");
      return;
    }
    actionUid.current = activeUser.uid;
    if (!onReady) {
      setFinished(true);
      return;
    }
    setBusy(true);
    setMessage(`${actionLabel}...`);
    try {
      const result = await onReady(activeUser);
      setFinished(true);
      setMessage(result?.message || "Done.");
    } catch (error) {
      actionUid.current = "";
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }, [actionLabel, manageAccount, onReady, requiresDesktopEmailVerification]);

  const shouldFinishProfile = useCallback((activeUser: User, activeProfile: Profile) => !requiresDesktopEmailVerification(activeUser) && (
    shouldAutomaticallyFinishAccountAction(
      Boolean(desktopLink),
      activeProfile.profileComplete,
      activeUser.uid,
      actionUid.current,
    ) || (
      Boolean(desktopLink) &&
      activeProfile.profileComplete &&
      explicitlySelectedUid.current === activeUser.uid &&
      actionUid.current !== activeUser.uid
    )
  ), [desktopLink, requiresDesktopEmailVerification]);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    if (nextUser?.isAnonymous && !desktopLink) {
      void signOut(auth);
      setUser(null);
      setProfile(null);
      return;
    }
    const nextAuthKey = nextUser
      ? `${nextUser.isAnonymous ? "anonymous" : "account"}:${nextUser.uid}`
      : "signed-out";
    if (observedAuthKey.current !== nextAuthKey) {
      observedAuthKey.current = nextAuthKey;
      setProfile(null);
      setFinished(false);
      setVerificationUser(null);
      if (actionUid.current && actionUid.current !== nextUser?.uid) actionUid.current = "";
    }
    setUser(nextUser);
    if (nextUser && !nextUser.isAnonymous) {
      if (explicitAuthPending.current) {
        explicitlySelectedUid.current = nextUser.uid;
        explicitAuthPending.current = false;
      }
      if (requiresDesktopEmailVerification(nextUser)) {
        setVerificationUser(nextUser);
        setMessage("Verify your email before linking this desktop.");
        return;
      }
      void loadProfile(nextUser)
        .then((nextProfile) => (
          nextProfile && shouldFinishProfile(nextUser, nextProfile)
            ? finishAction(nextUser, nextProfile)
            : undefined
        ))
        .catch((error) => setMessage(friendlyAuthError(error)));
    }
  }), [auth, desktopLink, finishAction, loadProfile, requiresDesktopEmailVerification, shouldFinishProfile]);

  async function googleSignIn() {
    explicitAuthPending.current = true;
    explicitAuthProvider.current = "google";
    explicitlySelectedUid.current = "";
    setBusy(true);
    setMessage("Opening Google sign in...");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      const activeUser = auth.currentUser;
      if (!activeUser || activeUser.isAnonymous) throw new Error("Google sign in did not finish.");
      explicitlySelectedUid.current = activeUser.uid;
      explicitAuthPending.current = false;
      const nextProfile = await loadProfile(activeUser);
      if (nextProfile && shouldFinishProfile(activeUser, nextProfile)) {
        await finishAction(activeUser, nextProfile);
      } else {
        setMessage(nextProfile?.profileComplete
          ? "Signed in."
          : "Almost done — choose the name other players will see.");
      }
    } catch (error) {
      explicitAuthPending.current = false;
      if (!auth.currentUser || auth.currentUser.isAnonymous) {
        explicitlySelectedUid.current = "";
        explicitAuthProvider.current = null;
      }
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function emailAuth(create: boolean) {
    explicitAuthPending.current = true;
    explicitAuthProvider.current = "email";
    explicitlySelectedUid.current = "";
    setBusy(true);
    setMessage(create ? "Creating your account..." : "Signing in...");
    try {
      if (create) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      const activeUser = auth.currentUser;
      if (!activeUser || activeUser.isAnonymous) throw new Error("Email sign in did not finish.");
      explicitlySelectedUid.current = activeUser.uid;
      explicitAuthPending.current = false;
      if (requiresDesktopEmailVerification(activeUser)) {
        setVerificationUser(activeUser);
        await sendEmailVerification(activeUser);
        setMessage(`Verification email sent to ${activeUser.email || email}. Open it, then return here.`);
        return;
      }
      const nextProfile = await loadProfile(activeUser);
      if (nextProfile && shouldFinishProfile(activeUser, nextProfile)) {
        await finishAction(activeUser, nextProfile);
      } else {
        setMessage(nextProfile?.profileComplete
          ? "Signed in."
          : "Almost done — choose the name other players will see.");
      }
    } catch (error) {
      explicitAuthPending.current = false;
      if (!auth.currentUser || auth.currentUser.isAnonymous) {
        explicitlySelectedUid.current = "";
        explicitAuthProvider.current = null;
      }
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!user || user.isAnonymous) return;
    const cleanName = displayName.trim();
    const cleanHandle = handle.trim().replace(/^@+/, "");
    if (!cleanName || isGeneratedName(cleanName)) {
      setMessage("Choose the name other players should see.");
      return;
    }
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,23}$/.test(cleanHandle)) {
      setMessage("Your handle needs 3–24 letters, numbers, underscores, or hyphens.");
      return;
    }
    setBusy(true);
    setMessage("Saving your RiftLite name...");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: cleanName, handle: cleanHandle }),
      });
      const payload = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error ?? "Could not save your profile.");
      setProfile(payload.profile);
      const shouldFinish = shouldFinishProfile(user, payload.profile);
      setMessage(shouldFinish ? "Profile ready." : "Profile saved. Confirm this is the account you want to link.");
      if (shouldFinish) await finishAction(user, payload.profile);
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  function changeDisplayName(value: string) {
    setDisplayName(value);
    if (!handleEdited) setHandle(suggestHandle(value));
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your email address first.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage("Password-reset email sent.");
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerificationEmail() {
    if (!verificationUser) return;
    setBusy(true);
    try {
      await sendEmailVerification(verificationUser);
      setMessage(`Verification email sent to ${verificationUser.email || "your email address"}.`);
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function checkEmailVerification() {
    if (!verificationUser) return;
    setBusy(true);
    setMessage("Checking your email verification...");
    try {
      await verificationUser.reload();
      await verificationUser.getIdToken(true);
      if (!verificationUser.emailVerified) {
        setMessage("That email is not verified yet. Open the verification email, then try again.");
        return;
      }
      setVerificationUser(null);
      const nextProfile = await loadProfile(verificationUser);
      if (nextProfile && shouldFinishProfile(verificationUser, nextProfile)) {
        await finishAction(verificationUser, nextProfile);
      } else {
        setMessage(nextProfile?.profileComplete ? "Email verified." : "Email verified. Now choose your RiftLite name.");
      }
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOutForAccountSwitch() {
    explicitAuthPending.current = false;
    explicitAuthProvider.current = null;
    explicitlySelectedUid.current = "";
    actionUid.current = "";
    setVerificationUser(null);
    await signOut(auth);
  }

  if (finished) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <CardTitle>{readyTitle}</CardTitle>
        <CardDescription>{message || `Signed in as ${profile?.displayName || user?.displayName || "RiftLite user"}.`}</CardDescription>
        <Button asChild><a href="/hubs">Open My Hubs</a></Button>
      </Card>
    );
  }

  if (verificationUser && user?.uid === verificationUser.uid) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <div>
          <CardTitle>Verify your email</CardTitle>
          <CardDescription className="mt-2">
            For account security, email/password accounts must verify {verificationUser.email || "their email address"} before linking a desktop.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void checkEmailVerification()}>{busy ? "Checking..." : "I've verified my email"}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void resendVerificationEmail()}>Send verification email again</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void signOutForAccountSwitch()}>Use a different account</Button>
        </div>
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>
    );
  }

  if (user && !user.isAnonymous && !profile) {
    return <Card className="mx-auto max-w-xl p-6"><CardDescription>Loading your RiftLite account...</CardDescription></Card>;
  }

  if (user && !user.isAnonymous && profile && !profile.profileComplete) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <div>
          <CardTitle>Choose your RiftLite name</CardTitle>
          <CardDescription className="mt-2">This is what hub members and Discord tools will show. It does not change your Atlas name.</CardDescription>
        </div>
        <label className="grid gap-2 text-sm text-slate-300">Display name
          <input className="social-input" value={displayName} onChange={(event) => changeDisplayName(event.target.value)} placeholder="Name other players will see" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">Unique handle
          <input className="social-input" value={handle} onChange={(event) => { setHandleEdited(true); setHandle(event.target.value); }} placeholder="your-handle" />
        </label>
        <Button disabled={busy} onClick={() => void saveProfile()}>{busy ? "Saving..." : actionLabel}</Button>
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>
    );
  }

  if (user && !user.isAnonymous && profile?.profileComplete) {
    if (manageAccount) {
      return (
        <Card className="mx-auto max-w-xl space-y-4 p-6">
          <div><CardTitle>Your RiftLite account</CardTitle><CardDescription className="mt-2">Update the name used by private hubs, Discord, and web tools.</CardDescription></div>
          <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 text-sm text-slate-300">
            <p><strong className="text-white">Signed in:</strong> {user.email || "Provider account"}</p>
            <p className="mt-1"><strong className="text-white">Account ID:</strong> {accountIdHint(profile.uid)}</p>
            <p className="mt-2 text-xs text-slate-400">The desktop app should show the same account ID after linking.</p>
          </div>
          <label className="grid gap-2 text-sm text-slate-300">Display name
            <input className="social-input" value={displayName} onChange={(event) => changeDisplayName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">Unique handle
            <input className="social-input" value={handle} onChange={(event) => { setHandleEdited(true); setHandle(event.target.value); }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void saveProfile()}>{busy ? "Saving..." : "Save changes"}</Button>
            <Button asChild variant="secondary"><a href="/hubs">My Hubs</a></Button>
            <Button variant="secondary" onClick={() => void signOutForAccountSwitch()}>Sign out</Button>
          </div>
          {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
        </Card>
      );
    }
    const identity = {
      uid: profile.uid,
      email: user.email ?? "",
      displayName: profile.displayName,
      handle: profile.handle,
    };
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6" data-desktop-link-confirmation={desktopLink ? "true" : undefined}>
        <CardTitle>{desktopLink ? "Link this desktop account?" : readyTitle}</CardTitle>
        <CardDescription>
          {desktopLink
            ? `Confirm that ${accountIdentityLabel(identity)} is the account this desktop should use.`
            : `Signed in as ${accountIdentityLabel(identity)}.`}
        </CardDescription>
        {desktopLink ? (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-slate-300">
            <p><strong className="text-white">Email:</strong> {identity.email || "Not supplied by provider"}</p>
            <p className="mt-1"><strong className="text-white">Account ID:</strong> {accountIdHint(identity.uid)}</p>
            <p className="mt-2 text-xs text-amber-100/80">New replay uploads, private hubs, Discord verification, and device sync will use this account.</p>
          </div>
        ) : null}
        <Button disabled={busy} onClick={() => void finishAction(user, profile)}>
          {busy
            ? `${actionLabel}...`
            : desktopLink
              ? `Link this desktop as @${profile.handle}`
              : actionLabel}
        </Button>
        <Button variant="secondary" onClick={() => void signOutForAccountSwitch()}>Use a different account</Button>
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>
    );
  }

  return (
    <Card
      className="mx-auto max-w-xl space-y-4 p-6"
      data-preferred-provider={preferredProvider}
    >
      <div>
        <CardTitle>Create or sign in</CardTitle>
        <CardDescription className="mt-2">{description}</CardDescription>
      </div>
      <Button autoFocus={preferredProvider === "google"} disabled={busy} onClick={() => void googleSignIn()}>Continue with Google</Button>
      <Button disabled={busy} variant="secondary" onClick={() => setEmailExpanded((value) => !value)}>Continue with email</Button>
      {emailExpanded ? (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <input autoFocus={preferredProvider === "email"} className="social-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" type="email" />
          <input className="social-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !email || !password} onClick={() => void emailAuth(false)}>Sign in with email</Button>
            <Button disabled={busy || !email || !password} variant="secondary" onClick={() => void emailAuth(true)}>Create with email</Button>
          </div>
          <button className="text-left text-sm text-sky-300 hover:text-sky-200" type="button" onClick={() => void resetPassword()}>Forgot password?</button>
        </div>
      ) : null}
      {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
    </Card>
  );
}

function suggestHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24);
}

function isGeneratedName(value: string) {
  const cleaned = value.trim().toLowerCase();
  return !cleaned || cleaned === "riftlite player" || cleaned === "riftlite user" || /^player(?:[ #_-]|$)/.test(cleaned) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned);
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : "Account setup failed.";
  return message
    .replace("Firebase: Error (auth/popup-closed-by-user).", "Google sign in was closed before it finished.")
    .replace("Firebase: Error (auth/invalid-credential).", "That email or password did not match.")
    .replace("Firebase: Error (auth/email-already-in-use).", "That email already has an account. Choose Sign in with email.")
    .replace("Firebase: Error (auth/weak-password).", "Choose a stronger password with at least six characters.");
}
