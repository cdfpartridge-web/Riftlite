"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
} from "firebase/auth";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { firebaseClientApp } from "@/lib/firebase/client";

export type HubInviteSummary = {
  inviteId: string;
  hubName: string;
  senderName: string;
  targetHandle: string;
  status: string;
  expiresAt: number;
  found: boolean;
};

export function HubInviteClient({ invite }: { invite: HubInviteSummary }) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loadedAt] = useState(() => Date.now());

  useEffect(() => onAuthStateChanged(auth, setUser), [auth]);

  const expired = invite.expiresAt > 0 && invite.expiresAt < loadedAt;
  const closed = invite.status && invite.status !== "open";
  const canAccept = invite.found && !expired && !closed;

  async function googleSignIn() {
    setBusy(true);
    setMessage("Opening Google sign in...");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setMessage("Signed in. You can accept the hub invite now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function emailAuth(createAccount: boolean) {
    setBusy(true);
    setMessage(createAccount ? "Creating account..." : "Signing in...");
    try {
      if (createAccount) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setMessage("Signed in. You can accept the hub invite now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite() {
    if (!user) {
      setMessage("Sign in first, then accept the invite.");
      return;
    }
    setBusy(true);
    setMessage("Accepting invite...");
    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch("/api/hubs/invites/accept", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inviteId: invite.inviteId }),
      });
      const payload = await response.json() as { error?: string; hub?: { name?: string } };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not accept invite.");
      }
      setAccepted(true);
      setMessage(`Joined ${payload.hub?.name ?? invite.hubName}. Open RiftLite and refresh social/hub data.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <Card className="space-y-5">
        <div>
          <CardTitle>{invite.found ? invite.hubName : "Invite unavailable"}</CardTitle>
          <CardDescription className="mt-2">
            {invite.found
              ? `${invite.senderName} invited you to join this private RiftLite hub.`
              : "This invite link could not be found. Ask the hub owner to create a new invite."}
          </CardDescription>
        </div>
        {invite.targetHandle ? (
          <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">
            This invite is reserved for @{invite.targetHandle}.
          </p>
        ) : null}
        {expired ? (
          <p className="rounded-2xl border border-amber-300/25 bg-amber-300/8 px-4 py-3 text-sm text-amber-100">
            This invite has expired. Ask the hub owner for a fresh link.
          </p>
        ) : null}
        {closed ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            This invite is already {invite.status}.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy || !canAccept || accepted} onClick={() => void acceptInvite()}>
            {accepted ? "Invite accepted" : "Accept invite"}
          </Button>
          <Button asChild variant="secondary">
            <a href="/download">Download RiftLite</a>
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <CardTitle>Sign in</CardTitle>
          <CardDescription className="mt-2">
            Use the same RiftLite profile you linked in the desktop app.
          </CardDescription>
        </div>
        <Button disabled={busy} onClick={() => void googleSignIn()}>Continue with Google</Button>
        <input
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email address"
          type="email"
          value={email}
        />
        <input
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !email || !password} onClick={() => void emailAuth(false)} variant="secondary">
            Sign in
          </Button>
          <Button disabled={busy || !email || !password} onClick={() => void emailAuth(true)} variant="secondary">
            Create account
          </Button>
        </div>
        <p className="text-sm text-slate-400">
          {user ? `Signed in as ${user.email ?? user.displayName ?? "RiftLite user"}.` : "Not signed in yet."}
        </p>
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>
    </div>
  );
}
