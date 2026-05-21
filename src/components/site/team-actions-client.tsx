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

type TeamMessage = {
  id: string;
  displayName: string;
  handle: string;
  text: string;
  pinned: boolean;
  createdAt: number;
};

type Application = {
  id: string;
  status: string;
};

export function TeamActionsClient({ teamId, slug, recruitmentStatus }: { teamId: string; slug: string; recruitmentStatus: string }) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [preferredLegends, setPreferredLegends] = useState<string[]>([]);
  const [availability, setAvailability] = useState("");
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [postText, setPostText] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), [auth]);
  useEffect(() => {
    if (user) {
      void loadApplication();
      void loadMessages();
    }
  }, [user, slug]);

  async function token() {
    if (!auth.currentUser) throw new Error("Sign in first.");
    return auth.currentUser.getIdToken();
  }

  async function googleSignIn() {
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setMessage("Signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function emailAuth(createAccount: boolean) {
    setBusy(true);
    try {
      if (createAccount) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setMessage("Signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function loadApplication() {
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/applications`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json() as { applications?: Application[] };
      setApplication(payload.applications?.[0] ?? null);
    } catch {
      setApplication(null);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/applications`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: applicationMessage,
          preferredLegends,
          availability,
        }),
      });
      const payload = await response.json() as { application?: Application; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not send application.");
      setApplication(payload.application ?? null);
      setMessage("Application sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send application.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMessages() {
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/messages`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json() as { messages?: TeamMessage[] };
      if (response.ok) setTeamMessages(payload.messages ?? []);
    } catch {
      setTeamMessages([]);
    }
  }

  async function postMessage() {
    if (!postText.trim()) return;
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: postText }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not post message.");
      setPostText("");
      setMessage("Posted to the team board.");
      await loadMessages();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not post message.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <Card className="space-y-4">
        <div>
          <CardTitle>Join the conversation</CardTitle>
          <CardDescription className="mt-2">Sign in with your linked RiftLite account to apply or read member-only posts.</CardDescription>
        </div>
        <Button disabled={busy} onClick={() => void googleSignIn()}>Continue with Google</Button>
        <input className="social-input" onChange={(event) => setEmail(event.target.value)} placeholder="Email address" type="email" value={email} />
        <input className="social-input" onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" value={password} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !email || !password} onClick={() => void emailAuth(false)} variant="secondary">Sign in</Button>
          <Button disabled={busy || !email || !password} onClick={() => void emailAuth(true)} variant="secondary">Create account</Button>
        </div>
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="space-y-4">
        <div>
          <CardTitle>Apply to team</CardTitle>
          <CardDescription className="mt-2">
            Applications are private to you and the team admins. Emails are never shown.
          </CardDescription>
        </div>
        {application ? (
          <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">
            Your application is {application.status}.
          </p>
        ) : recruitmentStatus === "closed" ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">Recruitment is currently closed.</p>
        ) : (
          <>
            <textarea className="social-input min-h-28" onChange={(event) => setApplicationMessage(event.target.value)} placeholder="Tell the team what you are looking for..." value={applicationMessage} />
            <select className="social-input" onChange={(event) => setPreferredLegends(Array.from(event.target.selectedOptions).map((option) => option.value))} multiple value={preferredLegends}>
              {LEGENDS.map((legend) => <option key={legend}>{legend}</option>)}
            </select>
            <input className="social-input" onChange={(event) => setAvailability(event.target.value)} placeholder="Availability / region / testing times" value={availability} />
            <Button disabled={busy} onClick={() => void apply()}>Send application</Button>
          </>
        )}
        {message ? <p className="text-sm text-cyan-200">{message}</p> : null}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Team board</CardTitle>
            <CardDescription className="mt-2">Member-only posts are paged and refreshed manually.</CardDescription>
          </div>
          <Button onClick={() => void loadMessages()} variant="secondary">Refresh</Button>
        </div>
        <textarea className="social-input min-h-24" onChange={(event) => setPostText(event.target.value)} placeholder="Post a note for the team..." value={postText} />
        <Button disabled={busy || !postText.trim()} onClick={() => void postMessage()}>Post message</Button>
        {teamMessages.length ? (
          <div className="grid gap-3">
            {teamMessages.map((item) => (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" key={item.id}>
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  <span>{item.displayName || item.handle || "RiftLite player"}</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
            If you are a team member, posts will appear here after refresh.
          </p>
        )}
      </Card>
    </div>
  );
}
