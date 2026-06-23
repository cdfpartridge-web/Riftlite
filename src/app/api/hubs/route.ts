import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";

import { hubIdFromName, requireUser, socialJson } from "@/lib/social/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const body = await readBody(req);
  const action = String(body.action ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const hubId = hubIdFromName(name);
  const passwordHash = hashPassword(password);

  if (!hubId || !name || !passwordHash) {
    return socialJson({ error: "Hub name and password are required" }, 400);
  }
  if (action !== "create" && action !== "join") {
    return socialJson({ error: "Hub action must be create or join" }, 400);
  }

  const hubRef = auth.db.collection("hubs").doc(hubId);
  const now = Date.now();
  try {
    if (action === "create") {
      await auth.db.runTransaction(async (tx) => {
        const existing = await tx.get(hubRef);
        if (existing.exists) {
          throw new Error("A private hub with that exact name already exists");
        }
        tx.set(hubRef, {
          id: hubId,
          name,
          password_hash: passwordHash,
          created_by: auth.decoded.uid,
          created_at: Math.floor(now / 1000),
          createdAt: now,
          hidden: true,
          updated_at: now,
        }, { merge: true });
      });
      return socialJson({ ok: true, hub: hubPayload(hubId, name, "owner", now) });
    }

    const snap = await hubRef.get();
    if (!snap.exists) throw new Error("Private hub name or password did not match");
    const data = snap.data() ?? {};
    const remoteHash = String(data.password_hash ?? data.passwordHash ?? "");
    if (!remoteHash || remoteHash !== passwordHash) {
      throw new Error("Private hub name or password did not match");
    }
    return socialJson({ ok: true, hub: hubPayload(hubId, String(data.name ?? name), "member", now) });
  } catch (error) {
    return socialJson({ error: error instanceof Error ? error.message : "Hub action failed" }, action === "create" ? 409 : 400);
  }
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hashPassword(password: string) {
  return password ? createHash("sha256").update(password).digest("hex") : "";
}

function hubPayload(id: string, name: string, role: "owner" | "member", now: number) {
  return {
    id,
    name,
    sync: true,
    role,
    claimed: false,
    joinedAt: new Date(now).toISOString(),
  };
}
