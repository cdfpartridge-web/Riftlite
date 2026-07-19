import { randomUUID } from "node:crypto";

import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { type NextRequest } from "next/server";

import { createFirebaseCustomToken, getFirestoreAdmin, verifyFirebaseIdToken } from "@/lib/firebase/admin";
import { desktopLinkAllowsIdentity, desktopLinkSignInIsVerified } from "@/lib/account-link";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { linkedReplayUid } from "@/lib/replay-v2-server/identity";
import {
  associateLinkedIdentity,
  ensureUserProfile,
  LinkedIdentityConflictError,
  repairHistoricalDesktopIdentityAssociations,
  socialJson,
} from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COMPLETION_LEASE_MS = 60_000;

type CompletionClaim = {
  kind: "claimed" | "already-complete" | "busy" | "not-found" | "wrong-code" | "expired" | "account-mismatch" | "used";
  desktopUid?: string;
};

export async function POST(req: NextRequest) {
  const db = getFirestoreAdmin();
  if (!db) return linkCompleteJson({ error: "Firebase admin is not configured" }, 503);

  const body = await readBody(req);
  const sessionId = String(body.sessionId ?? "").trim();
  const code = String(body.code ?? "").trim().toUpperCase();
  const idToken = String(body.idToken ?? "").trim();
  if (!sessionId || !code || !idToken) {
    return linkCompleteJson({ error: "Missing session, code, or id token" }, 400);
  }

  const decoded = await verifyFirebaseIdToken(idToken);
  if (!decoded) return linkCompleteJson({ error: "Invalid sign-in token" }, 401);
  if (!desktopLinkSignInIsVerified(decoded)) {
    return linkCompleteJson({ error: "Verify your email before linking this desktop." }, 403);
  }
  if (!linkedReplayUid(decoded)) return linkCompleteJson({ error: "Finish Google or email sign in before linking this desktop." }, 401);

  const ref = db.collection("desktopLinkSessions").doc(sessionId);
  const initialSnap = await ref.get();
  const initialData = initialSnap.data();
  if (!initialSnap.exists || !initialData) return linkCompleteJson({ error: "Link session not found" }, 404);

  const initialExpectedUidValue = String(initialData.expectedUid ?? "").trim();
  const [expectedUid, selectedUid] = await Promise.all([
    canonicalIdentityUid(initialExpectedUidValue, db),
    canonicalIdentityUid(decoded.uid, db),
  ]);
  if (!selectedUid) return linkCompleteJson({ error: "Could not resolve the selected RiftLite account" }, 409);

  const attemptId = randomUUID();
  const claim = await db.runTransaction(async (tx): Promise<CompletionClaim> => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data) return { kind: "not-found" };
    if (String(data.code ?? "").toUpperCase() !== code) return { kind: "wrong-code" };

    const status = String(data.status ?? "pending");
    if (status === "complete") {
      return String(data.linkedUid ?? "").trim() === selectedUid
        ? { kind: "already-complete" }
        : { kind: "used" };
    }
    if (Number(data.expiresAt ?? 0) < Date.now()) return { kind: "expired" };

    if (status === "completing") {
      if (String(data.completingUid ?? "").trim() !== selectedUid) return { kind: "account-mismatch" };
      if (Number(data.completionLeaseExpiresAt ?? 0) > Date.now()) return { kind: "busy" };
    } else if (status === "pending") {
      // The expected UID was canonicalized from the snapshot read immediately
      // before this transaction. If it changed while claiming, fail closed.
      if (String(data.expectedUid ?? "").trim() !== initialExpectedUidValue) return { kind: "used" };
      if (!desktopLinkAllowsIdentity(expectedUid, selectedUid)) return { kind: "account-mismatch" };
    } else {
      return { kind: "used" };
    }

    const now = Date.now();
    tx.set(ref, {
      status: "completing",
      expectedUid: expectedUid || selectedUid,
      completingUid: selectedUid,
      completionAttemptId: attemptId,
      completionAttempts: Math.max(0, Number(data.completionAttempts ?? 0)) + 1,
      completionAttemptAt: now,
      completionLeaseExpiresAt: now + COMPLETION_LEASE_MS,
      completionFailedAt: 0,
      completionError: "",
    }, { merge: true });
    return { kind: "claimed", desktopUid: String(data.desktopUid ?? "").trim() };
  });

  if (claim.kind !== "claimed") return completionClaimResponse(claim.kind);

  try {
    // Every operation below is idempotent. The immutable source-identity bind
    // also protects two different sessions created by the same desktop UID.
    await associateLinkedIdentity(claim.desktopUid ?? "", selectedUid);
    const profile = await ensureUserProfile(selectedUid, decoded.name ?? "", decoded.email ?? "");
    await repairHistoricalDesktopIdentityAssociations(selectedUid);
    const customToken = await createFirebaseCustomToken(selectedUid);
    if (!customToken) throw new Error("Could not create desktop sign-in token");

    const finalized = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!snap.exists || !data) return false;
      if (String(data.status ?? "") === "complete") {
        return String(data.linkedUid ?? "").trim() === selectedUid;
      }
      if (
        String(data.status ?? "") !== "completing" ||
        String(data.completingUid ?? "").trim() !== selectedUid ||
        String(data.completionAttemptId ?? "") !== attemptId
      ) {
        return false;
      }
      tx.set(ref, {
        status: "complete",
        expectedUid: expectedUid || selectedUid,
        linkedUid: selectedUid,
        linkedEmail: decoded.email ?? "",
        linkedName: profile.displayName,
        customToken,
        completedAt: Date.now(),
        completionLeaseExpiresAt: 0,
        completionError: "",
      }, { merge: true });
      return true;
    });
    if (!finalized) {
      return linkCompleteJson({ error: "This link attempt was replaced. Please try again." }, 409);
    }
    return linkCompleteJson({ ok: true });
  } catch (error) {
    await releaseCompletionClaim(db, ref, selectedUid, attemptId, error).catch(() => undefined);
    if (error instanceof LinkedIdentityConflictError) {
      return linkCompleteJson({
        error: "This desktop is already linked to another RiftLite account. Use Switch account in the desktop app if you intend to change accounts.",
      }, 409);
    }
    return linkCompleteJson({
      error: error instanceof Error && error.message === "Could not create desktop sign-in token"
        ? error.message
        : "Could not finish linking this desktop. Please try again.",
    }, 500);
  }
}

function completionClaimResponse(kind: CompletionClaim["kind"]): Response {
  if (kind === "already-complete") return linkCompleteJson({ ok: true });
  if (kind === "not-found") return linkCompleteJson({ error: "Link session not found" }, 404);
  if (kind === "wrong-code") return linkCompleteJson({ error: "Link code did not match" }, 403);
  if (kind === "expired") return linkCompleteJson({ error: "Link session expired" }, 410);
  if (kind === "busy") return linkCompleteJson({ error: "This account is already being linked. Please wait a moment and try again." }, 409);
  if (kind === "account-mismatch") {
    return linkCompleteJson({
      error: "This device must reconnect to the same RiftLite account. Use Switch account in the desktop app if you intend to change accounts.",
    }, 409);
  }
  return linkCompleteJson({ error: "Link session has already been used" }, 409);
}

function linkCompleteJson(body: Record<string, unknown>, status = 200): Response {
  const response = socialJson(body, status);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

async function releaseCompletionClaim(
  db: Firestore,
  ref: DocumentReference,
  selectedUid: string,
  attemptId: string,
  error: unknown,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (
      !snap.exists ||
      String(data?.status ?? "") !== "completing" ||
      String(data?.completingUid ?? "").trim() !== selectedUid ||
      String(data?.completionAttemptId ?? "") !== attemptId
    ) {
      return;
    }
    tx.set(ref, {
      completionLeaseExpiresAt: 0,
      completionFailedAt: Date.now(),
      completionError: error instanceof Error ? error.message.slice(0, 300) : "Desktop link completion failed",
    }, { merge: true });
  });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
