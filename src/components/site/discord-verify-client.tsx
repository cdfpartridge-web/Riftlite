"use client";

import type { User } from "firebase/auth";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";

export function DiscordVerifyClient({ code }: { code: string }) {
  async function verify(user: User) {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/discord/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json() as { error?: string; roleAssigned?: boolean; configuredRole?: boolean };
    if (!response.ok) throw new Error(payload.error ?? "Discord verification failed.");
    if (payload.roleAssigned) return { message: "Discord verified and your testing role was assigned." };
    if (payload.configuredRole) return { message: "Discord verified. Ask an admin to check the bot role position if your role is missing." };
    return { message: "Discord verified. This server has not configured an automatic role yet." };
  }

  return (
    <RiftLiteAuthPanel
      actionLabel="Verify Discord"
      description="Use the same RiftLite account as the desktop app. Verification will finish automatically after your profile is ready."
      onReady={verify}
      readyTitle="Discord verified"
    />
  );
}
