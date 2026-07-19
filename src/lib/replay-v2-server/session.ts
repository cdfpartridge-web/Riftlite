import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const REPLAY_EMBED_COOKIE = "riftlite_replay_session";
export const REPLAY_EMBED_SESSION_TTL_SECONDS = 10 * 60;
export const REPLAY_EMBED_SESSION_SECRET_ENV = "REPLAY_EMBED_SESSION_SECRET";

type EmbedSessionPayload = {
  v: 1;
  uid: string;
  iat: number;
  exp: number;
  nonce: string;
};

export function signReplayEmbedSession(
  uid: string,
  secret: string,
  nowMs = Date.now(),
  nonce = randomBytes(12).toString("base64url"),
): string {
  assertSessionSecret(secret);
  if (!uid || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) {
    throw new Error("Replay embed session uid is invalid.");
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const payload: EmbedSessionPayload = {
    v: 1,
    uid,
    iat: issuedAt,
    exp: issuedAt + REPLAY_EMBED_SESSION_TTL_SECONDS,
    nonce,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sessionSignature(encoded, secret)}`;
}

export function verifyReplayEmbedSession(token: string, secret: string, nowMs = Date.now()): string {
  try {
    assertSessionSecret(secret);
    if (token.length > 2_048) return "";
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
      return "";
    }
    const expected = Buffer.from(sessionSignature(encoded, secret), "utf8");
    const received = Buffer.from(signature, "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return "";

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<EmbedSessionPayload>;
    const now = Math.floor(nowMs / 1000);
    if (
      payload.v !== 1 ||
      typeof payload.uid !== "string" ||
      !payload.uid ||
      payload.uid.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(payload.uid) ||
      typeof payload.iat !== "number" ||
      !Number.isInteger(payload.iat) ||
      typeof payload.exp !== "number" ||
      !Number.isInteger(payload.exp) ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      payload.iat > now + 60 ||
      payload.exp <= now ||
      payload.exp - payload.iat !== REPLAY_EMBED_SESSION_TTL_SECONDS
    ) {
      return "";
    }
    return payload.uid;
  } catch {
    return "";
  }
}

export function configuredReplayEmbedSecret(): string {
  const secret = process.env[REPLAY_EMBED_SESSION_SECRET_ENV] ?? "";
  assertSessionSecret(secret);
  return secret;
}

export function replayEmbedUidFromCookie(request: Request): string {
  const secret = process.env[REPLAY_EMBED_SESSION_SECRET_ENV] ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) return "";
  const token = readCookie(request.headers.get("cookie") ?? "", REPLAY_EMBED_COOKIE);
  return token ? verifyReplayEmbedSession(token, secret) : "";
}

function sessionSignature(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

function assertSessionSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${REPLAY_EMBED_SESSION_SECRET_ENV} must contain at least 32 bytes.`);
  }
}

function readCookie(header: string, name: string): string {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }
  return "";
}
