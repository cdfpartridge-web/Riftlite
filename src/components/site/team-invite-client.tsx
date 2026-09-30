"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { TeamInviteSummary } from "@/lib/team-invites";

export function TeamInviteClient({ invite }: { invite: TeamInviteSummary }) {
  const [loadedAt] = useState(() => Date.now());
  const expired = invite.expiresAt > 0 && invite.expiresAt <= loadedAt;
  const closed = Boolean(invite.status && invite.status !== "open");
  const canAccept = invite.found && !expired && !closed;

  async function acceptInvite(user: User) {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/teams/invites/accept", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: invite.inviteId }),
    });
    const payload = await response.json() as { ok?: boolean; error?: string; alreadyMember?: boolean; team?: { name?: string } };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Could not accept this team invite.");
    const name = payload.team?.name ?? invite.teamName;
    return { message: payload.alreadyMember
      ? `Your account is already a member of ${name}. Open My Teams to view it.`
      : `You joined ${name}. Open My Teams to view your membership.` };
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <Card className="space-y-5">
        <div>
          <CardTitle>{invite.found ? invite.teamName : "Invite unavailable"}</CardTitle>
          <CardDescription className="mt-2">
            {invite.found ? `${invite.senderName} invited you to join this RiftLite team.` : "Ask a team owner or admin to create a new invite."}
          </CardDescription>
        </div>
        {invite.found && invite.targetHandle ? <p className="rounded-2xl border border-cyan-300/20 bg-cyan-300/8 px-4 py-3 text-sm text-cyan-100">Reserved for @{invite.targetHandle}</p> : null}
        {canAccept ? <p className="text-sm text-slate-300">This single-use invite expires 14 days after it was created. Check your account, then choose Join team. Each new member needs a separate invite.</p> : null}
        {expired && !closed ? <p className="text-sm text-amber-200">This invite expired. Ask a team owner or admin for a fresh invite addressed to your RiftLite handle.</p> : null}
        {closed ? <p className="text-sm text-slate-300">{invite.status === "accepted"
          ? "This single-use invite has already been used. That does not mean your current account joined the team. Check My Teams, or ask a team owner or admin for a fresh invite addressed to your RiftLite handle."
          : "This invite is no longer available. Ask a team owner or admin for a fresh invite addressed to your RiftLite handle."}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary"><Link href="/account/teams">Open My Teams</Link></Button>
          <Button asChild variant="secondary"><Link href="/download">Download RiftLite</Link></Button>
        </div>
      </Card>
      {canAccept ? (
        <RiftLiteAuthPanel
          actionLabel="Join team"
          description="Sign in with the same RiftLite account you use in the desktop app. Check the account shown before joining; you can switch accounts here."
          onReady={acceptInvite}
          requireActionConfirmation
          completionLink={{ href: "/account/teams", label: "Open My Teams" }}
          readyTitle={`Your membership in ${invite.teamName}`}
        />
      ) : null}
    </div>
  );
}
