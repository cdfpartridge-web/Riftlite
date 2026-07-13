"use client";

import { useMemo } from "react";
import type { User } from "firebase/auth";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";

export function AccountLinkClient({ sessionId, code }: { sessionId: string; code: string }) {
  const desktopLink = useMemo(() => ({ sessionId, code }), [sessionId, code]);

  async function complete(user: User) {
    const idToken = await user.getIdToken(true);
    const response = await fetch("/api/auth/link/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, code, idToken }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not link this desktop.");
    return { message: "This desktop is linked. Return to RiftLite — it will finish automatically." };
  }

  return (
    <RiftLiteAuthPanel
      actionLabel="Finish linking"
      description="Sign in once, choose your RiftLite name, and this desktop will link automatically. Existing local matches stay on the app."
      desktopLink={desktopLink}
      onReady={complete}
      readyTitle="RiftLite is linked"
    />
  );
}
