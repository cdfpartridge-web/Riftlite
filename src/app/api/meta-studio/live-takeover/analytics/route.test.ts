import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  readReport: vi.fn(),
}));

vi.mock("@/lib/community/meta-studio-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/meta-studio-auth")>();
  return { ...actual, requireMetaStudioSession: mocks.requireSession };
});
vi.mock("@/lib/live-takeover-analytics", () => ({
  readLiveTakeoverAnalyticsReport: mocks.readReport,
}));

import { GET } from "@/app/api/meta-studio/live-takeover/analytics/route";

describe("private live takeover analytics report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ uid: "owner", db: {} });
    mocks.readReport.mockResolvedValue({ selectedRunId: "run_1234567890123456" });
  });

  it("requires Meta Studio and forwards only the selected run id", async () => {
    const response = await GET(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/live-takeover/analytics?runId=run_1234567890123456",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(mocks.readReport).toHaveBeenCalledWith("run_1234567890123456");
  });

  it("does not read analytics for an unauthenticated request", async () => {
    mocks.requireSession.mockResolvedValue({
      error: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });
    const response = await GET(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/live-takeover/analytics",
    ));
    expect(response.status).toBe(401);
    expect(mocks.readReport).not.toHaveBeenCalled();
  });
});
