import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

vi.mock("@/lib/live-takeover-analytics", () => ({
  recordLiveTakeoverTelemetry: mocks.record,
}));

import { OPTIONS, POST } from "@/app/api/app/live-takeover/analytics/route";

describe("public live takeover analytics ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(undefined);
  });

  it("accepts signed telemetry through a no-store CORS endpoint", async () => {
    const body = { runId: "run_1234567890123456" };
    const response = await POST(new NextRequest(
      "https://www.riftlite.com/api/app/live-takeover/analytics",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.record).toHaveBeenCalledWith(body);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("fails closed for invalid tokens without exposing details", async () => {
    mocks.record.mockRejectedValue(new Error("invalid_token"));
    const response = await POST(new NextRequest(
      "https://www.riftlite.com/api/app/live-takeover/analytics",
      { method: "POST", body: "{}" },
    ));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_token" });
  });

  it("declares only POST for cross-origin desktop clients", async () => {
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });
});
