"use client";

import type { User } from "firebase/auth";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";

import styles from "./CasterStudio.module.css";

export function CasterStudioAccess() {
  async function createSession(user: User) {
    const token = await user.getIdToken(true);
    const response = await fetch("/api/meta-studio/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload?.error ?? "Caster Studio access was not granted.");
    }
    window.location.reload();
    return { message: "Opening Caster Studio..." };
  }

  return (
    <main className={styles.accessPage}>
      <div className={styles.accessGlow} />
      <section className={styles.accessIntro}>
        <div className={styles.brandLockup}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="RiftLite" src="/brand/riftlite-logo-transparent.png" />
          <div>
            <span>PRIVATE CREATOR WORKSPACE</span>
            <h1>RiftLite Caster Studio</h1>
          </div>
        </div>
        <p>
          Prepare a web replay, mark the moments you want to discuss, then switch
          to a clean 16:9 view for recording.
        </p>
        <div className={styles.accessFeatures}>
          <span>Private replay access</span>
          <span>Commentary controls</span>
          <span>Recording-safe output</span>
        </div>
      </section>
      <div className={styles.authPanel}>
        <RiftLiteAuthPanel
          actionLabel="Open Caster Studio"
          description="This private creator workspace is currently restricted to BMU."
          onReady={createSession}
          readyTitle="Caster Studio access"
        />
      </div>
    </main>
  );
}
