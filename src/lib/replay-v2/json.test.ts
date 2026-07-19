import { describe, expect, it } from "vitest";

import { redactRawText, redactSecrets } from "@/lib/replay-v2/json";

describe("replay credential redaction", () => {
  it("removes credential values without mistaking author identity for authorization", () => {
    expect(redactSecrets({
      authorPlayerId: "player-123",
      authToken: "top-secret-token",
      firebaseRefreshToken: "refresh-secret",
      clientSecret: "client-secret",
    })).toEqual({ authorPlayerId: "player-123" });
  });

  it("redacts credential strings in malformed raw-text diagnostics without changing player ids", () => {
    const redacted = redactRawText('{"authorPlayerId":"player-123","authToken":"top-secret-token"}');
    expect(redacted).toContain('"authorPlayerId":"player-123"');
    expect(redacted).toContain('"authToken":"[redacted]"');
    expect(redacted).not.toContain("top-secret-token");
  });
});
