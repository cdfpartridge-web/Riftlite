"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuth, onAuthStateChanged, signOut, type User } from "firebase/auth";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { firebaseClientApp } from "@/lib/firebase/client";

type Hub = { id: string; name: string; role: string; joinedAt: number };

export function MyHubsClient() {
  const auth = useMemo(() => getAuth(firebaseClientApp), []);
  const [user, setUser] = useState<User | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async (activeUser: User) => {
    setLoading(true);
    try {
      const token = await activeUser.getIdToken(true);
      const response = await fetch("/api/hubs", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json() as { hubs?: Hub[]; error?: string; code?: string };
      if (payload.code === "profile_incomplete") {
        setNeedsProfile(true);
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Could not load your hubs.");
      setHubs(payload.hubs ?? []);
      setNeedsProfile(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your hubs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser?.isAnonymous ? null : nextUser);
    setHubs([]);
    setNeedsProfile(false);
    if (nextUser && !nextUser.isAnonymous) void load(nextUser);
    else setLoading(false);
  }), [auth, load]);

  if (!user || needsProfile) {
    return <RiftLiteAuthPanel actionLabel="Open My Hubs" readyTitle="Your account is ready" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">Signed in as {user.email || user.displayName || "RiftLite user"}.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => user ? void load(user) : undefined}>Refresh</Button>
          <Button variant="secondary" onClick={() => void signOut(auth)}>Sign out</Button>
        </div>
      </div>
      {loading ? <p className="text-slate-300">Loading your hubs...</p> : hubs.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hubs.map((hub) => (
            <Card className="space-y-4" key={hub.id}>
              <div><CardTitle>{hub.name}</CardTitle><CardDescription className="mt-2">Role: {hubRoleLabel(hub.role)}</CardDescription></div>
              <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 font-mono text-sm text-cyan-100">Hub ID: {hub.id}</div>
              <Button asChild><a href={`riftlite://hubs/${encodeURIComponent(hub.id)}`}>Open in RiftLite</a></Button>
            </Card>
          ))}
        </div>
      ) : <Card><CardTitle>No hubs yet</CardTitle><CardDescription className="mt-2">Open a private-hub invite, or join by name and password inside RiftLite.</CardDescription></Card>}
      {message ? <p className="text-sm text-amber-200">{message}</p> : null}
    </div>
  );
}

function hubRoleLabel(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Co-owner";
  return "Member";
}
