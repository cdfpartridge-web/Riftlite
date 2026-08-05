import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOwnerReplays: vi.fn(),
  readCanonicalReplay: vi.fn(),
  requireMetaStudioSession: vi.fn(),
}));

vi.mock("@/lib/community/meta-studio-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/meta-studio-auth")>();
  return {
    ...actual,
    requireMetaStudioSession: mocks.requireMetaStudioSession,
  };
});

vi.mock("@/lib/replay-v2-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/replay-v2-server")>();
  return {
    ...actual,
    listOwnerReplays: mocks.listOwnerReplays,
    readCanonicalReplay: mocks.readCanonicalReplay,
  };
});

import { GET as getCasterReplay } from "@/app/api/meta-studio/caster/replays/[replayId]/route";
import { GET as listCasterReplays } from "@/app/api/meta-studio/caster/replays/route";
import { metaStudioJson } from "@/lib/community/meta-studio-auth";
import { ReplayV2Error, type ReplayRecord } from "@/lib/replay-v2-server";

const REPLAY_ID = `rl2_${"a".repeat(32)}`;
const CANONICAL_BYTES = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);

describe("Caster Studio replay list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMetaStudioSession.mockResolvedValue(principal());
    mocks.listOwnerReplays.mockResolvedValue([{
      replayId: REPLAY_ID,
      captureId: "capture-bmu",
      visibility: "private",
      status: "ready",
      title: "BMU vs Tester",
      platform: "atlas",
      roomCode: "private-room",
      messageCount: 12,
      createdAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:01:00.000Z",
    }]);
  });

  it("lists only the authenticated studio principal's replay library", async () => {
    const response = await listCasterReplays(request("/api/meta-studio/caster/replays?limit=999"));

    expect(response.status).toBe(200);
    expect(mocks.requireMetaStudioSession).toHaveBeenCalledOnce();
    expect(mocks.listOwnerReplays).toHaveBeenCalledWith("canonical-bmu", 100);
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      scope: "mine",
      items: [{ replayId: REPLAY_ID, captureId: "capture-bmu", visibility: "private" }],
    });
    expectPrivateStudioHeaders(response);
  });

  it("rejects before reading replay storage when the studio session is absent", async () => {
    mocks.requireMetaStudioSession.mockResolvedValue({
      error: metaStudioJson({ error: "Sign in to Meta Studio again." }, 401),
    });

    const response = await listCasterReplays(request("/api/meta-studio/caster/replays"));

    expect(response.status).toBe(401);
    expect(mocks.listOwnerReplays).not.toHaveBeenCalled();
    expectPrivateStudioHeaders(response);
  });
});

describe("Caster Studio replay read route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMetaStudioSession.mockResolvedValue(principal());
  });

  it("checks the private studio session before validating or reading a replay", async () => {
    mocks.requireMetaStudioSession.mockResolvedValue({
      error: metaStudioJson({ error: "This RiftLite account cannot open Meta Studio." }, 403),
    });

    const response = await getCasterReplay(
      request("/api/meta-studio/caster/replays/not-a-replay"),
      context("not-a-replay"),
    );

    expect(response.status).toBe(403);
    expect(mocks.readCanonicalReplay).not.toHaveBeenCalled();
    expectPrivateStudioHeaders(response);
  });

  it("returns a private owner summary while canonical processing is pending", async () => {
    mocks.readCanonicalReplay.mockResolvedValue({ record: replayRecord({ status: "processing" }) });

    const response = await getCasterReplay(
      request(`/api/meta-studio/caster/replays/${REPLAY_ID}`),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(202);
    expect(mocks.readCanonicalReplay).toHaveBeenCalledWith(REPLAY_ID, "canonical-bmu");
    await expect(response.json()).resolves.toMatchObject({
      replay: {
        replayId: REPLAY_ID,
        captureId: "capture-bmu",
        visibility: "private",
        status: "processing",
      },
    });
    expectPrivateStudioHeaders(response);
  });

  it("streams the canonical gzip artifact with private studio response headers", async () => {
    const record = replayRecord({
      status: "ready",
      visibility: "unlisted",
      canonicalArtifact: canonicalArtifact(),
    });
    mocks.readCanonicalReplay.mockResolvedValue({ record, bytes: CANONICAL_BYTES });

    const response = await getCasterReplay(
      request(`/api/meta-studio/caster/replays/${REPLAY_ID}`),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CANONICAL_BYTES);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-length")).toBe(String(CANONICAL_BYTES.length));
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="${REPLAY_ID}.json"`);
    expect(response.headers.get("etag")).toBe(`"${canonicalArtifact().sha256}"`);
    expect(response.headers.get("x-riftlite-replay-id")).toBe(REPLAY_ID);
    expect(response.headers.get("x-riftlite-replay-visibility")).toBe("unlisted");
    expectPrivateStudioHeaders(response);
  });

  it("returns a private 304 when the canonical artifact has not changed", async () => {
    const artifact = canonicalArtifact();
    const record = replayRecord({
      status: "ready",
      visibility: "public",
      canonicalArtifact: artifact,
    });
    mocks.readCanonicalReplay.mockResolvedValue({ record, bytes: CANONICAL_BYTES });

    const response = await getCasterReplay(
      request(`/api/meta-studio/caster/replays/${REPLAY_ID}`, {
        headers: { "If-None-Match": `"${artifact.sha256}"` },
      }),
      context(REPLAY_ID),
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${artifact.sha256}"`);
    expectPrivateStudioHeaders(response);
  });

  it("does not turn studio access into a private-replay admin bypass", async () => {
    mocks.readCanonicalReplay.mockRejectedValue(
      new ReplayV2Error(403, "replay_private", "Replay is private."),
    );

    const response = await getCasterReplay(
      request(`/api/meta-studio/caster/replays/${REPLAY_ID}`),
      context(REPLAY_ID),
    );

    expect(mocks.readCanonicalReplay).toHaveBeenCalledWith(REPLAY_ID, "canonical-bmu");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "replay_private" });
    expectPrivateStudioHeaders(response);
  });
});

function principal() {
  return {
    uid: "canonical-bmu",
    decoded: { uid: "canonical-bmu" },
    db: {},
  };
}

function replayRecord(overrides: Partial<ReplayRecord> = {}): ReplayRecord {
  return {
    schema: "riftlite-replay-record",
    version: 2,
    replayId: REPLAY_ID,
    ownerUid: "canonical-bmu",
    captureId: "capture-bmu",
    visibility: "private",
    status: "ready",
    title: "BMU vs Tester",
    platform: "atlas",
    localReplayId: "local-bmu",
    matchId: "match-bmu",
    seriesId: "series-bmu",
    roomCode: "private-room",
    messageCount: 12,
    expectedRaw: { sha256: "b".repeat(64), bytes: 100 },
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    updatedAt: new Date("2026-08-05T12:01:00.000Z"),
    ...overrides,
  };
}

function canonicalArtifact() {
  return {
    provider: "vercel-blob" as const,
    kind: "canonical" as const,
    generation: "canonical-generation",
    pathname: `replay-v2/canonical/${REPLAY_ID}/artifact.json.gz`,
    sha256: "c".repeat(64),
    bytes: CANONICAL_BYTES.length,
    contentType: "application/gzip" as const,
  };
}

function request(path: string, init?: RequestInit) {
  return new NextRequest(`https://www.riftlite.com${path}`, init);
}

function context(replayId: string) {
  return { params: Promise.resolve({ replayId }) };
}

function expectPrivateStudioHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("vary")).toContain("Authorization");
  expect(response.headers.get("vary")).toContain("Cookie");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
}
