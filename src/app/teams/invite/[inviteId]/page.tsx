import type { Metadata } from "next";

import { SectionHeading } from "@/components/site/section-heading";
import { TeamInviteClient } from "@/components/site/team-invite-client";
import { loadTeamInviteSummary } from "@/lib/team-invites";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Team Invite | RiftLite",
  description: "Join a RiftLite team with your own RiftLite account.",
  robots: { index: false, follow: false },
};

export default async function TeamInvitePage({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  const invite = await loadTeamInviteSummary(inviteId);
  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="Team invitation"
        headingLevel={1}
        title="Accept team invite"
        description="Check your RiftLite account, then confirm that you want to join. Opening this page does not accept the invitation."
      />
      <TeamInviteClient invite={invite} />
    </div>
  );
}
