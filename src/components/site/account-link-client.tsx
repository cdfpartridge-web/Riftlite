"use client";

import { useLayoutEffect, useMemo } from "react";
import type { User } from "firebase/auth";

import {
  RiftLiteAuthPanel,
  type AuthProviderHint,
} from "@/components/site/riftlite-auth-panel";

export function AccountLinkClient({
  sessionId,
  code,
  preferredProvider,
}: {
  sessionId: string;
  code: string;
  preferredProvider?: AuthProviderHint;
}) {
  const desktopLink = useMemo(() => ({ sessionId, code }), [sessionId, code]);

  useLayoutEffect(() => {
    // The server has already passed the short-lived values into this mounted
    // component. Remove them from the address bar before any later navigation
    // can expose them through copied URLs, browser history, or referrers.
    if (window.location.search) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);

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
      preferredProvider={preferredProvider}
      readyTitle="RiftLite is linked"
    />
  );
}
