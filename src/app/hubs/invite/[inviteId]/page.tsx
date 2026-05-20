import type { Metadata } from "next";

import { HubInviteClient, type HubInviteSummary } from "@/components/site/hub-invite-client";
import { SectionHeading } from "@/components/site/section-heading";
import { getFirestoreAdmin } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Private Hub Invite | RiftLite",
  description: "Accept a private RiftLite hub invite.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function HubInvitePage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const { inviteId } = await params;
  const invite = await loadInvite(inviteId);

  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="Private hub"
        headingLevel={1}
        title="Accept hub invite"
        description="Join a private RiftLite hub with your linked profile. The old hub name/password flow still works inside the desktop app."
      />
      <HubInviteClient invite={invite} />
    </div>
  );
}

async function loadInvite(inviteId: string): Promise<HubInviteSummary> {
  const cleanInviteId = inviteId.trim();
  const empty: HubInviteSummary = {
    inviteId: cleanInviteId,
    hubName: "Private hub",
    senderName: "A RiftLite player",
    targetHandle: "",
    status: "",
    expiresAt: 0,
    found: false,
  };

  if (!/^[a-f0-9]{8,64}$/i.test(cleanInviteId)) {
    return empty;
  }

  const db = getFirestoreAdmin();
  if (!db) {
    return empty;
  }

  const snap = await db.collection("hubInvites").doc(cleanInviteId).get().catch(() => null);
  const data = snap?.data();
  if (!snap?.exists || !data) {
    return empty;
  }

  return {
    inviteId: cleanInviteId,
    hubName: text(data.hubName) || "Private hub",
    senderName: text(data.senderDisplayName) || text(data.senderHandle) || "A RiftLite player",
    targetHandle: text(data.targetHandle).replace(/^@+/, ""),
    status: text(data.status) || "open",
    expiresAt: numberValue(data.expiresAt),
    found: true,
  };
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
