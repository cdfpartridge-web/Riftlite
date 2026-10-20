"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAuth, onIdTokenChanged, type User } from "firebase/auth";
import { firebaseClientApp } from "@/lib/firebase/client";

export class ReviewRequestError extends Error {
  constructor(public status: number, public payload: Record<string, unknown>) {
    super(typeof payload.error === "string" ? payload.error : "Your review could not be synced. Please try again.");
  }
}

export class StaleReviewRequest extends Error {}

/** One mounted consumer, one authentication boundary. Private data never enters browser storage. */
export function useReviewAccountSession(onBoundary: () => void) {
  const boundaryRef = useRef(onBoundary);
  useLayoutEffect(() => { boundaryRef.current = onBoundary; }, [onBoundary]);
  const active = useRef(true);
  const generation = useRef(0);
  const currentUser = useRef<User | null>(null);
  const [session, setSession] = useState({ ready: false, key: 0 });

  useEffect(() => {
    active.current = true;
    let initialized = false;
    let uid: string | null = null;
    const accept = (user: User | null) => {
      if (!active.current) return;
      const linked = user && !user.isAnonymous ? user : null;
      const nextUid = linked?.uid ?? null;
      currentUser.current = linked;
      if (!initialized || nextUid !== uid) {
        initialized = true;
        uid = nextUid;
        generation.current += 1;
        boundaryRef.current();
        setSession({ ready: true, key: generation.current });
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onIdTokenChanged(getAuth(firebaseClientApp), accept, () => accept(null));
    } catch {
      // A desktop embed can authenticate using its HttpOnly session without Firebase.
      accept(null);
    }
    return () => {
      active.current = false;
      generation.current += 1;
      unsubscribe?.();
    };
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const requestGeneration = generation.current;
    const headers = new Headers(init.headers);
    const user = currentUser.current;
    if (user) {
      try {
        headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
      } catch (error) {
        if (!active.current || requestGeneration !== generation.current) throw new StaleReviewRequest();
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (["auth/user-token-expired", "auth/invalid-user-token", "auth/user-disabled", "auth/user-not-found", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked"].includes(code)) {
          throw new ReviewRequestError(401, { code: "authentication_required", error: "Your account session expired. Reconnect your account to continue." });
        }
        throw error;
      }
    }
    if (!active.current || requestGeneration !== generation.current) throw new StaleReviewRequest();
    const response = await fetch(path, { ...init, headers, credentials: "include", cache: "no-store" });
    const value: unknown = await response.json().catch(() => null);
    if (!active.current || requestGeneration !== generation.current) throw new StaleReviewRequest();
    const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!response.ok) throw new ReviewRequestError(response.status, payload);
    if (typeof payload.accountId !== "string" || !payload.accountId) throw new Error("The server could not confirm your RiftLite account. Please try again.");
    return payload;
  }, []);
  return { ...session, request };
}

export function reviewErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Your review could not be synced. Please try again.";
}
