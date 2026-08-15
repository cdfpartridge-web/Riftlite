import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFirestoreAdmin: vi.fn(),
  sessionSet: vi.fn(),
  runGet: vi.fn(),
  sessionGet: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

import {
  createLiveTakeoverAnalyticsToken,
  readLiveTakeoverAnalyticsReport,
  recordLiveTakeoverTelemetry,
  verifyLiveTakeoverAnalyticsToken,
  withLiveTakeoverAnalyticsAccess,
} from "@/lib/live-takeover-analytics";

function document(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

describe("private live takeover analytics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
    process.env.LIVE_TAKEOVER_ANALYTICS_SECRET = "test-secret-with-enough-entropy";
    mocks.sessionSet.mockReset();
    mocks.runGet.mockReset();
    mocks.sessionGet.mockReset();
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: (name: string) => {
        if (name === "live_takeover_analytics_sessions") {
          return {
            doc: () => ({ set: mocks.sessionSet }),
            where: () => ({ limit: () => ({ get: mocks.sessionGet }) }),
          };
        }
        return {
          orderBy: () => ({ limit: () => ({ get: mocks.runGet }) }),
        };
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LIVE_TAKEOVER_ANALYTICS_SECRET;
  });

  it("issues scoped expiring access without exposing it for an inactive takeover", () => {
    const token = createLiveTakeoverAnalyticsToken("run_1234567890123456", "StressCasts");
    expect(token).toBeTruthy();
    expect(verifyLiveTakeoverAnalyticsToken(
      token!,
      "run_1234567890123456",
      "stresscasts",
    )).toBe(true);
    expect(verifyLiveTakeoverAnalyticsToken(
      token!,
      "run_different_1234567",
      "stresscasts",
    )).toBe(false);

    const inactive = withLiveTakeoverAnalyticsAccess({
      enabled: true,
      provider: "twitch",
      channelLogin: "stresscasts",
      title: "Live",
      active: false,
      status: "offline",
      channelUrl: "https://www.twitch.tv/stresscasts",
    }, "run_1234567890123456");
    expect(inactive).not.toHaveProperty("analytics");
  });

  it("blind-writes anonymous run-scoped session state without reading Firestore", async () => {
    const runId = "run_1234567890123456";
    const token = createLiveTakeoverAnalyticsToken(runId, "stresscasts")!;
    await recordLiveTakeoverTelemetry({
      runId,
      token,
      installId: "install-id-1234567890",
      sessionId: "session-id-1234567890",
      channelLogin: "stresscasts",
      event: "checkpoint",
      hasPlayed: true,
      watchedSeconds: 600,
      startedAt: "2026-08-15T11:50:00.000Z",
      occurredAt: "2026-08-15T12:00:00.000Z",
      appVersion: "0.9.43",
      platform: "win32",
    });

    expect(mocks.sessionSet).toHaveBeenCalledOnce();
    const [stored, options] = mocks.sessionSet.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(stored).toMatchObject({
      runId,
      channelLogin: "stresscasts",
      lastEvent: "checkpoint",
      hasPlayed: true,
      watchedSeconds: 600,
      playing: true,
      appVersion: "0.9.43",
      platform: "win32",
    });
    expect(stored).not.toHaveProperty("installId");
    expect(stored).not.toHaveProperty("sessionId");
    expect(stored.viewerHash).toMatch(/^[a-f0-9]{48}$/);
    expect(options).toEqual({ merge: true });
    expect(mocks.runGet).not.toHaveBeenCalled();
    expect(mocks.sessionGet).not.toHaveBeenCalled();
  });

  it("aggregates only anonymous sessions in the authenticated report path", async () => {
    const now = Date.now();
    mocks.runGet.mockResolvedValue({
      docs: [document("run_1234567890123456", {
        channelLogin: "stresscasts",
        title: "Store championship",
        startedAt: { toMillis: () => now - 60 * 60 * 1_000 },
        endedAt: null,
      })],
    });
    mocks.sessionGet.mockResolvedValue({
      size: 3,
      docs: [
        document("s1", {
          viewerHash: "viewer-a",
          hasPlayed: true,
          watchedSeconds: 600,
          playing: true,
          lastSeenAt: { toMillis: () => now - 60_000 },
          activityBuckets: ["2026-08-15T11:50:00.000Z", "2026-08-15T12:00:00.000Z"],
          appVersion: "0.9.43",
          platform: "win32",
        }),
        document("s2", {
          viewerHash: "viewer-b",
          hasPlayed: true,
          watchedSeconds: 300,
          playing: false,
          lastSeenAt: { toMillis: () => now - 20 * 60_000 },
          activityBuckets: ["2026-08-15T12:00:00.000Z"],
          appVersion: "0.9.43",
          platform: "darwin",
          dismissed: true,
        }),
        document("s3", {
          viewerHash: "viewer-a",
          hasPlayed: false,
          watchedSeconds: 0,
          playing: false,
          appVersion: "0.9.43",
          platform: "win32",
        }),
      ],
    });

    const report = await readLiveTakeoverAnalyticsReport();
    expect(report.summary).toEqual({
      impressions: 3,
      uniqueViewers: 2,
      playbackStarts: 2,
      currentViewers: 1,
      totalWatchSeconds: 900,
      averageWatchSeconds: 450,
      peakConcurrent: 2,
      dismissals: 1,
    });
    expect(report.timeline).toEqual([
      { bucket: "2026-08-15T11:50:00.000Z", viewers: 1 },
      { bucket: "2026-08-15T12:00:00.000Z", viewers: 2 },
    ]);
    expect(report.privacy).toBe("anonymous-run-scoped");
  });
});
