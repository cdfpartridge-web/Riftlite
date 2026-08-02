import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { type NextRequest, NextResponse } from "next/server";

import {
  getFirestoreAdmin,
  verifyFirebaseSessionCookie,
} from "@/lib/firebase/admin";
import { canonicalIdentityUid } from "@/lib/identity-server";
import { requireUser } from "@/lib/social/server";

export const META_STUDIO_SESSION_COOKIE = "riftlite_meta_studio";
export const META_STUDIO_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

type MetaStudioPrincipal = {
  uid: string;
  decoded: DecodedIdToken;
  db: Firestore;
};

function configuredMetaStudioUids(value = process.env.RIFTLITE_META_STUDIO_UIDS ?? "") {
  return new Set(
    value
      .split(",")
      .map((uid) => uid.trim())
      .filter(Boolean),
  );
}

export function metaStudioUidAllowed(
  uid: string,
  configured = process.env.RIFTLITE_META_STUDIO_UIDS ?? "",
) {
  return configuredMetaStudioUids(configured).has(uid);
}

export function applyMetaStudioPrivateHeaders<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization, Cookie");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export function metaStudioJson(
  body: Record<string, unknown>,
  status = 200,
) {
  return applyMetaStudioPrivateHeaders(NextResponse.json(body, { status }));
}

function allowlistUnavailable() {
  return configuredMetaStudioUids().size === 0;
}

function authorizeUid(uid: string) {
  if (allowlistUnavailable()) {
    return metaStudioJson({ error: "Meta Studio access is not configured." }, 503);
  }
  if (!metaStudioUidAllowed(uid)) {
    return metaStudioJson({ error: "This RiftLite account cannot open Meta Studio." }, 403);
  }
  return null;
}

export async function requireMetaStudioBearer(
  request: NextRequest,
): Promise<
  | ({ token: string; authenticatedUid: string } & MetaStudioPrincipal)
  | { error: NextResponse }
> {
  const auth = await requireUser(request);
  if ("error" in auth && auth.error) {
    return { error: applyMetaStudioPrivateHeaders(auth.error) };
  }
  const accessError = authorizeUid(auth.decoded.uid);
  if (accessError) return { error: accessError };
  return {
    uid: auth.decoded.uid,
    decoded: auth.decoded,
    db: auth.db,
    token: auth.token,
    authenticatedUid: auth.authenticatedUid,
  };
}

export async function verifyMetaStudioSession(
  sessionCookie: string,
): Promise<MetaStudioPrincipal | null> {
  if (!sessionCookie || allowlistUnavailable()) return null;
  const [decoded, db] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie),
    Promise.resolve(getFirestoreAdmin()),
  ]);
  if (!decoded || !db) return null;
  const uid = await canonicalIdentityUid(decoded.uid, db);
  if (!metaStudioUidAllowed(uid)) return null;
  return {
    uid,
    decoded: uid === decoded.uid ? decoded : { ...decoded, uid },
    db,
  };
}

export async function requireMetaStudioSession(
  request: NextRequest,
): Promise<MetaStudioPrincipal | { error: NextResponse }> {
  if (allowlistUnavailable()) {
    return { error: metaStudioJson({ error: "Meta Studio access is not configured." }, 503) };
  }
  const sessionCookie = request.cookies.get(META_STUDIO_SESSION_COOKIE)?.value ?? "";
  const principal = await verifyMetaStudioSession(sessionCookie);
  if (!principal) {
    return { error: metaStudioJson({ error: "Sign in to Meta Studio again." }, 401) };
  }
  return principal;
}
