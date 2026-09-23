import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type OpeningToken = {
  replayId: string;
  revision: string;
  gameId: string;
  step: number;
  expires: number;
};
const key = (secret: string) => {
  if (Buffer.byteLength(secret) < 32)
    throw new Error("Opening practice is not configured.");
  return createHash("sha256")
    .update(`riftlite-opening-lab-v1:${secret}`)
    .digest();
};

/** Authenticated encryption keeps unlisted IDs and source identity out of browser-readable tokens. */
export function sealOpeningToken(value: OpeningToken, secret: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function openOpeningToken(
  token: string,
  secret: string,
  now = Date.now(),
): OpeningToken {
  try {
    if (!/^[A-Za-z0-9_-]{50,2048}$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        key(secret),
        bytes.subarray(0, 12),
      );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      typeof value.replayId !== "string" ||
      typeof value.revision !== "string" ||
      typeof value.gameId !== "string" ||
      !Number.isInteger(value.step) ||
      value.step < 0 ||
      value.step > 4 ||
      !Number.isFinite(value.expires) ||
      value.expires <= now ||
      value.expires > now + 2 * 60 * 60 * 1000
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      "This practice session expired or changed. Start a new opening.",
    );
  }
}
