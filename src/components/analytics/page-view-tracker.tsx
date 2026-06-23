"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const PAGE_VIEW_THROTTLE_MS = 10 * 60 * 1000;

function shouldTrack(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_RIFTLITE_ANALYTICS_DISABLED === "1") return false;

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return host.endsWith("riftlite.com");
}

function recentlyTracked(key: string): boolean {
  try {
    const storageKey = `riftlite:page-view:${key}`;
    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(storageKey) ?? "0");
    if (Number.isFinite(last) && now - last < PAGE_VIEW_THROTTLE_MS) {
      return true;
    }
    window.sessionStorage.setItem(storageKey, String(now));
  } catch {
    // Analytics should never rely on browser storage being available.
  }
  return false;
}

export function PageViewTracker() {
  const pathname = usePathname();
  const lastTrackedRef = useRef("");

  useEffect(() => {
    if (!pathname || !shouldTrack()) return;

    const key = `${pathname}|${document.title}`;
    if (lastTrackedRef.current === key) return;
    if (recentlyTracked(key)) return;
    lastTrackedRef.current = key;

    const payload = JSON.stringify({
      path: pathname,
      title: document.title,
      source: "website",
      referrer: document.referrer,
      occurredAt: new Date().toISOString(),
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/analytics/page-view", blob);
      return;
    }

    void fetch("/api/analytics/page-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Page-view tracking should never interrupt the actual site experience.
    });
  }, [pathname]);

  return null;
}
