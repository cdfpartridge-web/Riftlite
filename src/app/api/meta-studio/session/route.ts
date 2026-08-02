import { type NextRequest } from "next/server";

import {
  META_STUDIO_SESSION_COOKIE,
  META_STUDIO_SESSION_TTL_MS,
  metaStudioJson,
  requireMetaStudioBearer,
} from "@/lib/community/meta-studio-auth";
import { createFirebaseSessionCookie } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireMetaStudioBearer(request);
  if ("error" in auth) return auth.error;

  const sessionCookie = await createFirebaseSessionCookie(
    auth.token,
    META_STUDIO_SESSION_TTL_MS,
  );
  if (!sessionCookie) {
    return metaStudioJson({ error: "Meta Studio could not create a secure session." }, 503);
  }

  const response = metaStudioJson({
    ok: true,
    expiresIn: Math.floor(META_STUDIO_SESSION_TTL_MS / 1000),
  });
  response.cookies.set({
    name: META_STUDIO_SESSION_COOKIE,
    value: sessionCookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(META_STUDIO_SESSION_TTL_MS / 1000),
  });
  return response;
}

export async function DELETE() {
  const response = metaStudioJson({ ok: true });
  response.cookies.set({
    name: META_STUDIO_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
