import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/auth/link/bootstrap/route";

describe("retired desktop auth bootstrap", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
  ])("returns a private no-store 410 for %s without issuing a token", async (_method, handler) => {
    const response = handler();
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toMatchObject({ error: expect.stringContaining("retired") });
    expect(payload).not.toHaveProperty("customToken");
  });
});
