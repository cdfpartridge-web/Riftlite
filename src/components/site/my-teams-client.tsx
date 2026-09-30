"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuth, onAuthStateChanged, signOut, type User } from "firebase/auth";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import { TeamInviteManager, teamRequest, type PendingTeamInvite } from "@/components/site/team-invite-manager";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { firebaseClientApp } from "@/lib/firebase/client";

type Team = { id: string; name: string; slug: string; visibility: string; memberCount: number };
type TeamDetail = { team: Team; myRole: string; members: Array<{ uid: string; displayName: string; handle: string; role: string }> };

export function MyTeamsClient() {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [readyUid, setReadyUid] = useState("");
  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser?.isAnonymous ? null : nextUser);
    setReadyUid("");
  }), [auth]);

  if (!user || readyUid !== user.uid) {
    return <RiftLiteAuthPanel actionLabel="Open My Teams" readyTitle="Your account is ready" onReady={async (activeUser) => {
      if (auth.currentUser?.uid === activeUser.uid) setReadyUid(activeUser.uid);
    }} />;
  }
  return <MyTeamsAccount key={user.uid} user={user} onSignOut={() => void signOut(auth)} />;
}

export function MyTeamsAccount({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<PendingTeamInvite[]>([]);
  const [selected, setSelected] = useState("");
  const [teamRevision, setTeamRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    const results = await Promise.allSettled([
      teamRequest<{ teams: Team[] }>(user, "/api/teams?mine=1&limit=80"),
      teamRequest<{ invites: PendingTeamInvite[] }>(user, "/api/teams/invites"),
    ]);
    if (!active.current || request !== sequence.current) return;
    const [teamResult, inviteResult] = results;
    setError("");
    setTeams(teamResult.status === "fulfilled" ? teamResult.value.teams : []);
    setSelected((current) => teamResult.status === "fulfilled" && teamResult.value.teams.some((team) => team.id === current) ? current : "");
    setTeamRevision((current) => current + 1);
    setInvites(inviteResult.status === "fulfilled" ? inviteResult.value.invites : []);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") setError(errorMessage(failure.reason));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    active.current = true;
    // Fetch account data on mount; state updates happen after the responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { active.current = false; };
  }, [load]);

  async function respond(invite: PendingTeamInvite, accept: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const payload = await teamRequest<{ alreadyMember?: boolean; team?: Team }>(user, `/api/teams/invites/${accept ? "accept" : "decline"}`, "POST", { inviteId: invite.inviteId });
      if (!active.current) return;
      setMessage(accept ? payload.alreadyMember ? `You already belong to ${invite.teamName}.` : `You joined ${invite.teamName}.` : "Invitation declined.");
      setInvites((current) => current.filter((item) => item.inviteId !== invite.inviteId));
      if (accept) {
        setLoading(true);
        await load();
        if (active.current) setSelected(payload.team?.id || invite.teamId);
      }
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-400">Signed in as {user.email || user.displayName || "RiftLite player"}.</p>
      <div className="flex gap-2"><Button variant="secondary" disabled={loading || busy} onClick={() => { setLoading(true); setError(""); void load(); }}>Refresh teams</Button><Button variant="ghost" onClick={onSignOut}>Use a different account</Button></div>
    </div>
    {message ? <p className="text-sm text-cyan-200" role="status">{message}</p> : null}
    {error ? <p className="text-sm text-amber-200" role="alert">{error}</p> : null}
    {invites.length ? <Card className="space-y-4">
      <CardTitle>Team invitations</CardTitle>
      <CardDescription>Choose Join team to accept with the RiftLite account shown above.</CardDescription>
      {invites.map((invite) => <div key={invite.inviteId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
        <div><h3 className="font-semibold text-white">{invite.teamName}</h3><p className="text-sm text-slate-400">Invited by {invite.senderName} · Expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div>
        <div className="flex gap-2"><Button disabled={busy} onClick={() => void respond(invite, true)}>Join team</Button><Button variant="secondary" disabled={busy} onClick={() => void respond(invite, false)}>Decline</Button></div>
      </div>)}
    </Card> : null}
    {loading ? <p className="text-slate-300">Loading your teams…</p> : teams.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {teams.map((team) => <Card className="space-y-4" key={team.id}>
        <div><CardTitle>{team.name}</CardTitle><CardDescription className="mt-2">{team.visibility === "private" ? "Private team" : "Public team"} · {team.memberCount} members</CardDescription></div>
        <Button variant={selected === team.id ? "default" : "secondary"} onClick={() => setSelected(team.id)}>Open team</Button>
      </Card>)}
    </div> : !error ? <Card><CardTitle>No teams yet</CardTitle><CardDescription className="mt-2">Accept a team invitation here, or ask the owner for an invite link.</CardDescription></Card> : null}
    {selected ? <SelectedTeam key={`${user.uid}:${selected}:${teamRevision}`} user={user} teamId={selected} onClose={() => setSelected("")} /> : null}
  </div>;
}

function SelectedTeam({ user, teamId, onClose }: { user: User; teamId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void teamRequest<TeamDetail>(user, `/api/teams/${encodeURIComponent(teamId)}`).then((payload) => {
      if (active) setDetail(payload);
    }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [user, teamId]);
  return <Card className="space-y-5">
    <div className="flex items-center justify-between gap-3"><CardTitle>{detail?.team.name || "Your team"}</CardTitle><Button variant="ghost" onClick={onClose}>Close team</Button></div>
    {error ? <p role="alert" className="text-sm text-amber-200">{error}</p> : !detail ? <p className="text-sm text-slate-400">Loading team…</p> : <>
      <CardDescription>Your role: {detail.myRole}. Open Community → Teams in RiftLite Desktop for the team board and match history.</CardDescription>
      {detail.myRole === "owner" || detail.myRole === "admin" ? <TeamInviteManager key={`${user.uid}:${teamId}`} user={user} teamId={teamId} /> : null}
      <div className="space-y-2"><h3 className="font-semibold text-white">Members</h3>{detail.members.map((member) => <p key={member.uid} className="text-sm text-slate-300">{member.displayName || member.handle} <span className="text-slate-500">· {member.role}</span></p>)}</div>
    </>}
  </Card>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load your teams. Please try again.";
}
