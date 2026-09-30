"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

import { Button } from "@/components/ui/button";

export type PendingTeamInvite = {
  inviteId: string;
  teamId: string;
  teamName: string;
  senderName: string;
  targetHandle: string;
  status: string;
  expiresAt: number;
};

export async function teamRequest<T>(user: User, path: string, method = "GET", body?: unknown): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not complete this team action. Please try again.");
  return payload as T;
}

// Mount with a key containing account and team IDs to discard old form state.
export function TeamInviteManager({ user, teamId }: { user: User; teamId: string }) {
  const [handle, setHandle] = useState("");
  const [invites, setInvites] = useState<PendingTeamInvite[]>([]);
  const [link, setLink] = useState<{ inviteId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const sequence = useRef(0);
  const endpoint = `/api/teams/${encodeURIComponent(teamId)}/invites`;

  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const payload = await teamRequest<{ invites: PendingTeamInvite[] }>(user, endpoint);
      if (active.current && request === sequence.current) setInvites(payload.invites);
    } catch (cause) {
      if (active.current && request === sequence.current) setError(errorMessage(cause));
    } finally {
      if (active.current && request === sequence.current) setLoading(false);
    }
  }, [user, endpoint]);

  useEffect(() => {
    active.current = true;
    // Fetch invitations on mount; state updates happen after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { active.current = false; };
  }, [load]);

  async function create(targeted: boolean) {
    if (busy || (targeted && !handle.trim().replace(/^@+/, ""))) return;
    setBusy(true);
    setError("");
    setMessage("");
    setLink(null);
    try {
      const payload = await teamRequest<{ invite: PendingTeamInvite; inviteUrl: string }>(user, endpoint, "POST", {
        targetHandle: targeted ? handle.trim() : "",
      });
      if (!active.current) return;
      setLink({ inviteId: payload.invite.inviteId, url: payload.inviteUrl });
      setMessage(targeted
        ? `Invitation sent to @${payload.invite.targetHandle}. They can join from My Teams, or you can share this link.`
        : "Link ready. Share it with one person you want to invite.");
      setHandle("");
      await load();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function revoke(invite: PendingTeamInvite) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await teamRequest(user, `${endpoint}/${encodeURIComponent(invite.inviteId)}`, "DELETE");
      if (!active.current) return;
      setInvites((current) => current.filter((item) => item.inviteId !== invite.inviteId));
      if (link?.inviteId === invite.inviteId) setLink(null);
      setMessage("Invitation cancelled. Its link can no longer be used.");
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      if (active.current) setMessage("Invite link copied.");
    } catch {
      if (active.current) setMessage("Select the link below and copy it to share.");
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.04] p-5" aria-label="Invite member">
      <div>
        <h3 className="font-display text-xl font-semibold text-white">Invite member</h3>
        <p className="mt-1 text-sm text-slate-300">Send to a RiftLite handle, or create a link for someone new. Each invite admits one person and expires after 14 days.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void create(true); }}>
        <label className="grid flex-1 gap-2 text-sm text-slate-300">RiftLite handle
          <input className="social-input" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="@player" maxLength={40} autoComplete="off" />
        </label>
        <Button disabled={busy || !handle.trim().replace(/^@+/, "")} type="submit">Send invite</Button>
        <Button disabled={busy} variant="secondary" type="button" onClick={() => void create(false)}>Create invite link</Button>
      </form>
      {message ? <p role="status" className="text-sm text-cyan-200">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-amber-200">{error}</p> : null}
      {link ? <div className="flex flex-wrap gap-3">
        <input aria-label="Invite link" className="social-input min-w-0 flex-1" readOnly value={link.url} onFocus={(event) => event.target.select()} />
        <Button variant="secondary" onClick={() => void copyLink()}>Copy link</Button>
      </div> : null}
      <div className="space-y-3 border-t border-white/10 pt-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-white">Pending invitations</h4>
          <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => { setLoading(true); setError(""); void load(); }}>Refresh invitations</Button>
        </div>
        {loading ? <p className="text-sm text-slate-400">Loading invitations…</p> : invites.length ? invites.map((invite) => (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm" key={invite.inviteId}>
            <div><span className="text-white">{invite.targetHandle ? `@${invite.targetHandle}` : "Shareable invite link"}</span>
              <span className="ml-2 text-slate-400">Expires {new Date(invite.expiresAt).toLocaleDateString()}</span></div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void revoke(invite)}>Cancel invite</Button>
          </div>
        )) : <p className="text-sm text-slate-400">No pending invitations.</p>}
      </div>
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not complete this team action. Please try again.";
}
