import { describe, expect, it } from "vitest";
import { openOpeningToken, sealOpeningToken } from "./token";
const secret = "test-only-opening-secret-32-bytes-long";
const payload = {
  replayId: "unlisted-secret-id",
  revision: "sha",
  gameId: "game",
  step: 0,
  expires: Date.now() + 60_000,
};
describe("opaque opening sessions", () => {
  it("round trips without disclosing an unlisted source ID", () => {
    const token = sealOpeningToken(payload, secret);
    expect(Buffer.from(token, "base64url").toString()).not.toContain(
      payload.replayId,
    );
    expect(openOpeningToken(token, secret)).toEqual(payload);
    expect(sealOpeningToken(payload, secret)).not.toBe(token);
  });
  it("rejects tampering, another key, expired sessions and invented steps", () => {
    const token = sealOpeningToken(payload, secret),
      bytes = Buffer.from(token, "base64url");
    bytes[30] ^= 1;
    expect(() =>
      openOpeningToken(bytes.toString("base64url"), secret),
    ).toThrow();
    expect(() => openOpeningToken(token, secret + "other")).toThrow();
    expect(() =>
      openOpeningToken(token, secret, payload.expires + 1),
    ).toThrow();
    expect(() =>
      openOpeningToken(
        sealOpeningToken({ ...payload, step: 5 }, secret),
        secret,
      ),
    ).toThrow();
  });
});
