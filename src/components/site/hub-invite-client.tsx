"use client";

import type { User } from "firebase/auth";
import { useState } from "react";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

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
  const [loadedAt] = useState(() => Date.now());
  const expired = invite.expiresAt > 0 && invite.expiresAt < loadedAt;
  const closed = Boolean(invite.status && invite.status !== "open");
  const canAccept = invite.found && !expired && !closed;

  async function acceptInvite(user: User) {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/hubs/invites/accept", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: invite.inviteId }),
    });
    const payload = await response.json() as { error?: string; alreadyMember?: boolean; hub?: { name?: string } };
    if (!response.ok) throw new Error(payload.error ?? "Could not accept this invite.");
    if (payload.alreadyMember) return { message: `Your account is already a member of ${payload.hub?.name ?? invite.hubName}. Open My Hubs to view it.` };
    return { message: `You joined ${payload.hub?.name ?? invite.hubName}. It will appear in RiftLite automatically after refresh.` };
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <Card className="space-y-5">
        <div>
          <CardTitle>{invite.found ? invite.hubName : "Invite unavailable"}</CardTitle>
          <CardDescription className="mt-2">
            {invite.found ? `${invite.senderName} invited you to this private RiftLite hub.` : "Ask the hub owner to create a new invite."}
          </CardDescription>
        </div>
        {invite.targetHandle ? <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">Reserved for @{invite.targetHandle}</p> : null}
        {canAccept ? <p className="text-sm text-slate-300">This invite can be used by one new member. Check your account, then choose Join private hub. Ask the admin for a separate invite for each player.</p> : null}
        {expired && !closed ? <p className="text-sm text-amber-200">This invite expired. Ask the hub admin for a fresh invite addressed to your RiftLite handle.</p> : null}
        {closed ? <p className="text-sm text-slate-300">{invite.status === "accepted"
          ? "This single-use invite has already been used. That does not mean your current account joined the hub. Check My Hubs, or ask the admin for a fresh invite addressed to your RiftLite handle."
          : "This invite is no longer available. Ask the hub admin for a fresh invite addressed to your RiftLite handle."}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary"><a href="/hubs">Open My Hubs</a></Button>
          <Button asChild variant="secondary"><a href="/download">Download RiftLite</a></Button>
        </div>
      </Card>
      {canAccept ? (
        <RiftLiteAuthPanel
          actionLabel="Join private hub"
          description="Sign in with the same RiftLite account you use in the desktop app and for Discord. You will confirm your account before joining."
          onReady={acceptInvite}
          requireActionConfirmation
          readyTitle={`Your membership in ${invite.hubName}`}
        />
      ) : null}
    </div>
  );
}
