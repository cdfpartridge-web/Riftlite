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
  uid: string;
  displayName: string;
  handle: string;
  text: string;
  pinned: boolean;
  deleted?: boolean;
  createdAt: number;
};

type Application = {
  id: string;
  status: string;
  displayName?: string;
  handle?: string;
  message?: string;
  preferredLegends?: string[];
  availability?: string;
  createdAt?: number;
};

type TeamMember = {
  uid: string;
  displayName: string;
  handle: string;
  role: "owner" | "admin" | "member";
};

export function TeamActionsClient({ teamId, slug, recruitmentStatus }: { teamId: string; slug: string; recruitmentStatus: string }) {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationMessage, setApplicationMessage] = useState("");
  const [preferredLegends, setPreferredLegends] = useState<string[]>([]);
  const [availability, setAvailability] = useState("");
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const [postText, setPostText] = useState("");
  const [myRole, setMyRole] = useState<"" | "owner" | "admin" | "member">("");
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => onAuthStateChanged(auth, setUser), [auth]);
  useEffect(() => {
    if (user) {
      void loadTeamTools();
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
      setApplications(payload.applications ?? []);
    } catch {
      setApplications([]);
    }
  }

  async function loadTeamTools() {
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json() as { members?: TeamMember[]; myRole?: "" | "owner" | "admin" | "member" };
      if (response.ok) {
        setMembers(payload.members ?? []);
        setMyRole(payload.myRole ?? "");
      }
    } catch {
      setMembers([]);
      setMyRole("");
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
      setApplications(payload.application ? [payload.application] : []);
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

  async function reviewApplication(applicationId: string, status: "accepted" | "declined") {
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/applications/${encodeURIComponent(applicationId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not review application.");
      setMessage(status === "accepted" ? "Application accepted." : "Application declined.");
      await loadApplication();
      await loadTeamTools();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review application.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberRole(uid: string, role: "admin" | "member") {
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(uid)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update member.");
      setMessage("Member role updated.");
      await loadTeamTools();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update member.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(uid: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from this team?`)) return;
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(uid)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not remove member.");
      setMessage("Member removed.");
      await loadTeamTools();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMessage(messageId: string) {
    if (!window.confirm("Delete this team message?")) return;
    setBusy(true);
    try {
      const idToken = await token();
      const response = await fetch(`/api/teams/${encodeURIComponent(slug)}/messages/${encodeURIComponent(messageId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not delete message.");
      await loadMessages();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete message.");
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

  const canManage = myRole === "owner" || myRole === "admin";
  const canPromoteAdmins = myRole === "owner";
  const application = applications[0] ?? null;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="space-y-4">
        {canManage ? (
          <>
            <div>
              <CardTitle>Team management</CardTitle>
              <CardDescription className="mt-2">Review applications, assign admins, remove inactive members, and moderate posts.</CardDescription>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Applications</div>
                {applications.length ? (
                  <div className="space-y-3">
                    {applications.map((item) => (
                      <div className="rounded-xl border border-white/10 bg-slate-950/35 p-3" key={item.id}>
                        <div className="font-semibold text-white">{item.displayName || item.handle || "RiftLite player"}</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{item.message || "No message"}</p>
                        {item.preferredLegends?.length ? <p className="mt-2 text-xs text-slate-400">Legends: {item.preferredLegends.join(", ")}</p> : null}
                        {item.availability ? <p className="mt-1 text-xs text-slate-400">Availability: {item.availability}</p> : null}
                        {item.status === "pending" ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button disabled={busy} onClick={() => void reviewApplication(item.id, "accepted")}>Accept</Button>
                            <Button disabled={busy} onClick={() => void reviewApplication(item.id, "declined")} variant="secondary">Decline</Button>
                          </div>
                        ) : <p className="mt-2 text-sm text-cyan-200">Application is {item.status}.</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-300">No applications waiting.</p>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Members</div>
                <div className="grid gap-2">
                  {members.map((member) => (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2" key={member.uid}>
                      <span className="font-semibold text-white">{member.displayName || member.handle || "RiftLite player"}</span>
                      {member.role === "owner" ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">owner</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {canPromoteAdmins ? (
                            <select className="social-input min-h-0 w-32 py-2 text-xs" disabled={busy} onChange={(event) => void updateMemberRole(member.uid, event.target.value as "admin" | "member")} value={member.role}>
                              <option value="member">member</option>
                              <option value="admin">admin</option>
                            </select>
                          ) : <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">{member.role}</span>}
                          <Button disabled={busy} onClick={() => void removeMember(member.uid, member.displayName || member.handle || "this member")} variant="secondary">Remove</Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <CardTitle>{myRole ? "Your team membership" : "Apply to team"}</CardTitle>
              <CardDescription className="mt-2">
                Applications are private to you and the team admins. Emails are never shown.
              </CardDescription>
            </div>
            {myRole ? (
              <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">
                You are a {myRole} of this team.
              </p>
            ) : application ? (
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
                  <div className="flex items-center gap-2">
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                    {canManage ? <Button disabled={busy} onClick={() => void deleteMessage(item.id)} size="sm" variant="secondary">Delete</Button> : null}
                  </div>
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
