"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInWithPopup,
  type User,
} from "firebase/auth";

import { firebaseClientApp } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function AccountLinkClient({ sessionId, code }: { sessionId: string; code: string }) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), [auth]);

  async function bootstrapDesktopUser() {
    const response = await fetch("/api/auth/link/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, code }),
    });
    const payload = await response.json() as { customToken?: string; error?: string };
    if (!response.ok || !payload.customToken) {
      throw new Error(payload.error ?? "Could not prepare desktop account link.");
    }
    const credential = await signInWithCustomToken(auth, payload.customToken);
    return credential.user;
  }

  async function google() {
    setBusy(true);
    setMessage("Preparing desktop link...");
    try {
      const desktopUser = await bootstrapDesktopUser();
      setMessage("Opening Google sign in...");
      try {
        await linkWithPopup(desktopUser, new GoogleAuthProvider());
        setMessage("Google linked to this RiftLite desktop. Finishing...");
      } catch (error) {
        if (!isCredentialConflict(error)) throw error;
        setMessage("That Google account already exists, signing in to it instead...");
        await signInWithPopup(auth, new GoogleAuthProvider());
      }
      await complete(auth.currentUser);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function emailSignIn(create: boolean) {
    setBusy(true);
    setMessage(create ? "Preparing email account..." : "Preparing email sign in...");
    try {
      const desktopUser = await bootstrapDesktopUser();
      const emailCredential = EmailAuthProvider.credential(email, password);
      try {
        await linkWithCredential(desktopUser, emailCredential);
        setMessage("Email linked to this RiftLite desktop. Finishing...");
      } catch (error) {
        if (!isCredentialConflict(error)) throw error;
        if (create) {
          throw new Error("That email already has an account. Use Sign in instead.");
        }
        setMessage("That email already exists, signing in to it instead...");
        await signInWithEmailAndPassword(auth, email, password);
      }
      await complete(auth.currentUser);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function complete(activeUser: User | null = user) {
    if (!activeUser) {
      setMessage("Sign in first, then link this device.");
      return;
    }
    setBusy(true);
    setMessage("Linking RiftLite...");
    try {
      const idToken = await activeUser.getIdToken(true);
      const response = await fetch("/api/auth/link/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, code, idToken }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Link failed.");
      }
      setMessage("Linked. You can return to RiftLite now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Link failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-xl p-6">
      <CardTitle>Link RiftLite</CardTitle>
      <CardDescription className="mt-2">
        Sign in to attach this desktop install to your RiftLite profile. Existing no-login data stays on the app.
      </CardDescription>
      <div className="mt-5 grid gap-3">
        <Button disabled={busy} onClick={google}>Continue with Google</Button>
        <input
          className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email address"
          type="email"
          value={email}
        />
        <input
          className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !email || !password} onClick={() => void emailSignIn(false)} variant="secondary">Sign in</Button>
          <Button disabled={busy || !email || !password} onClick={() => void emailSignIn(true)} variant="secondary">Create account</Button>
        </div>
        <Button disabled={busy || !user} onClick={() => void complete()}>
          Link this desktop
        </Button>
      </div>
      <p className="mt-4 text-sm text-slate-400">
        {user ? `Signed in as ${user.email ?? user.displayName ?? "RiftLite user"}.` : "Not signed in yet."}
      </p>
      {message ? <p className="mt-2 text-sm text-cyan-200">{message}</p> : null}
    </Card>
  );
}

function isCredentialConflict(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "auth/credential-already-in-use" || code === "auth/email-already-in-use" || code === "auth/account-exists-with-different-credential";
}
