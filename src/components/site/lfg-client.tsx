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
import { LEGENDS } from "@/lib/constants";
import { firebaseClientApp } from "@/lib/firebase/client";

type LfgListing = {
  id: string;
  displayName: string;
  handle: string;
  platform: string;
  roomCode: string;
  format: string;
  myLegend: string;
  lookingForLegends: string[];
  allowAny: boolean;
  note: string;
  expiresAt: number;
  uid: string;
  discordInviteUrl?: string;
  discordVoiceExpiresAt?: number;
};

const PLATFORMS = [
  { value: "tcga", label: "TCGA" },
  { value: "atlas", label: "RiftAtlas" },
];

export function LfgClient() {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [listings, setListings] = useState<LfgListing[]>([]);
  const [form, setForm] = useState({
    platform: "atlas",
    roomCode: "",
    format: "Bo3",
    myLegend: "Vex",
    allowAny: true,
    lookingForLegends: [] as string[],
    note: "",
  });

  useEffect(() => onAuthStateChanged(auth, setUser), [auth]);

  useEffect(() => {
    if (user) void refreshListings(false);
  }, [user]);

  async function getToken() {
    if (!auth.currentUser) throw new Error("Sign in first.");
    return auth.currentUser.getIdToken();
  }

  async function refreshListings(showMessage = true) {
    if (!auth.currentUser) return;
    setBusy(true);
    try {
      const token = await getToken();
      const response = await fetch("/api/lfg?mine=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as { listings?: LfgListing[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load listings.");
      setListings(payload.listings ?? []);
      if (showMessage) setMessage("Find Match refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load listings.");
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setMessage("Opening Google sign in...");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setMessage("Signed in. You can post or copy room codes now.");
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
      setMessage("Signed in. You can post or copy room codes now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createListing() {
    setBusy(true);
    setMessage("Posting listing...");
    try {
      const token = await getToken();
      const response = await fetch("/api/lfg", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: form.platform,
          roomCode: form.roomCode,
          format: form.format,
          myLegend: form.myLegend,
          lookingForLegends: form.allowAny ? [] : form.lookingForLegends,
          allowAny: form.allowAny,
          note: form.note,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not create listing.");
      setForm((current) => ({ ...current, roomCode: "", note: "" }));
      setMessage("Listing posted for 15 minutes.");
      await refreshListings(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create listing.");
    } finally {
      setBusy(false);
    }
  }

  async function closeListing(id: string) {
    setBusy(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/lfg/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not close listing.");
      setMessage("Listing closed.");
      await refreshListings(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close listing.");
    } finally {
      setBusy(false);
    }
  }

  async function createVoice(listing: LfgListing) {
    setBusy(true);
    setMessage("Creating Discord voice room...");
    try {
      const token = await getToken();
      const response = await fetch(`/api/lfg/${encodeURIComponent(listing.id)}/voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not create Discord voice.");
      setMessage("Discord voice room ready.");
      await refreshListings(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create Discord voice.");
    } finally {
      setBusy(false);
    }
  }

  function joinVoice(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage("Opening Discord invite...");
  }

  async function copyRoomCode(code: string) {
    await navigator.clipboard.writeText(code);
    setMessage(`Copied ${code}.`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <Card className="space-y-5">
        <div>
          <CardTitle>Post a match</CardTitle>
          <CardDescription className="mt-2">
            Listings are visible to signed-in RiftLite users for 15 minutes. Room codes disappear when closed or expired.
          </CardDescription>
        </div>
        {user ? (
          <div className="grid gap-3">
            <select className="social-input" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>
              {PLATFORMS.map((platform) => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
            </select>
            <input className="social-input" placeholder="Room code" value={form.roomCode} onChange={(event) => setForm({ ...form, roomCode: event.target.value })} />
            <select className="social-input" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>
              <option>Bo1</option>
              <option>Bo3</option>
            </select>
            <select className="social-input" value={form.myLegend} onChange={(event) => setForm({ ...form, myLegend: event.target.value })}>
              {LEGENDS.map((legend) => <option key={legend}>{legend}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200">
              <input checked={form.allowAny} onChange={(event) => setForm({ ...form, allowAny: event.target.checked })} type="checkbox" />
              Any desired legend
            </label>
            <select className="social-input min-h-32" disabled={form.allowAny} multiple value={form.lookingForLegends} onChange={(event) => setForm({ ...form, lookingForLegends: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>
              {LEGENDS.map((legend) => <option key={legend}>{legend}</option>)}
            </select>
            <p className="text-xs text-slate-400">Hold Ctrl or Cmd to select multiple preferred legends.</p>
            <textarea className="social-input min-h-24" placeholder="Optional note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            <Button disabled={busy || !form.roomCode.trim()} onClick={() => void createListing()}>Post for 15 minutes</Button>
          </div>
        ) : (
          <SignInPanel
            busy={busy}
            email={email}
            onEmail={setEmail}
            onEmailAuth={emailAuth}
            onGoogle={googleSignIn}
            onPassword={setPassword}
            password={password}
          />
        )}
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Active listings</CardTitle>
            <CardDescription className="mt-2">Copy a code and jump into the room. V1 keeps it simple: no reservations or queue.</CardDescription>
          </div>
          <Button disabled={busy || !user} onClick={() => void refreshListings()} variant="secondary">Refresh</Button>
        </div>
        {!user ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">Sign in to view active room codes.</p>
        ) : listings.length ? (
          <div className="grid gap-3">
            {listings.map((listing) => (
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 p-4" key={listing.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-lg font-semibold text-white">{listing.myLegend} looking for {listing.allowAny ? "Any" : listing.lookingForLegends.join(", ")}</div>
                    <p className="text-sm text-slate-300">{listing.displayName} - {listing.platform.toUpperCase()} - {listing.format}</p>
                    {listing.note ? <p className="mt-2 text-sm text-slate-300">{listing.note}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void copyRoomCode(listing.roomCode)} size="sm">Copy {listing.roomCode}</Button>
                    {listing.discordInviteUrl ? (
                      <Button onClick={() => joinVoice(listing.discordInviteUrl ?? "")} size="sm" variant="secondary">Join voice</Button>
                    ) : null}
                    {listing.uid === user.uid && !listing.discordInviteUrl ? (
                      <Button onClick={() => void createVoice(listing)} size="sm" variant="secondary">Create voice</Button>
                    ) : null}
                    {listing.uid === user.uid ? <Button onClick={() => void closeListing(listing.id)} size="sm" variant="secondary">Close</Button> : null}
                  </div>
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Expires {new Date(listing.expiresAt).toLocaleTimeString()}
                  {listing.discordInviteUrl && listing.discordVoiceExpiresAt ? ` - Voice ${new Date(listing.discordVoiceExpiresAt).toLocaleTimeString()}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">No active listings right now.</p>
        )}
      </Card>
    </div>
  );
}

function SignInPanel({
  busy,
  email,
  onEmail,
  onEmailAuth,
  onGoogle,
  onPassword,
  password,
}: {
  busy: boolean;
  email: string;
  onEmail: (value: string) => void;
  onEmailAuth: (createAccount: boolean) => Promise<void>;
  onGoogle: () => Promise<void>;
  onPassword: (value: string) => void;
  password: string;
}) {
  return (
    <div className="grid gap-3">
      <Button disabled={busy} onClick={() => void onGoogle()}>Continue with Google</Button>
      <input className="social-input" onChange={(event) => onEmail(event.target.value)} placeholder="Email address" type="email" value={email} />
      <input className="social-input" onChange={(event) => onPassword(event.target.value)} placeholder="Password" type="password" value={password} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !email || !password} onClick={() => void onEmailAuth(false)} variant="secondary">Sign in</Button>
        <Button disabled={busy || !email || !password} onClick={() => void onEmailAuth(true)} variant="secondary">Create account</Button>
      </div>
    </div>
  );
}
