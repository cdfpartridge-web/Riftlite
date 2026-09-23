import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openingTestReplay } from "./fixture";
const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  artifact: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: () => ({
    collection: () => ({
      where: () => ({
        limit: () => ({
          get: async () => ({
            size: 1,
            docs: [{ id: "secret-unlisted-id", data: () => mocks.data }],
          }),
        }),
      }),
      doc: () => ({
        get: async () => ({
          id: "secret-unlisted-id",
          exists: true,
          data: () => mocks.data,
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/replay-v2-server/artifacts", () => ({
  readImmutableArtifact: (...args: unknown[]) => mocks.artifact(...args),
}));
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv(
    "REPLAY_EMBED_SESSION_SECRET",
    "test-only-server-secret-with-32-bytes",
  );
  const replay = openingTestReplay();
  const own = replay.events[0];
  if (own.kind !== "snapshot") throw Error("fixture");
  mocks.data = {
    status: "ready",
    visibility: "unlisted",
    ownerUid: "secret-owner",
    listing: {
      playerName: "secret-owner",
      opponentName: "secret-opponent",
      playerLegend: own.snapshot.players["secret-owner"].zones.legend[0].name,
      opponentLegend:
        own.snapshot.players["secret-opponent"].zones.legend[0].name,
    },
    canonicalArtifact: { sha256: "revision-1" },
  };
  mocks.artifact
    .mockReset()
    .mockResolvedValue(gzipSync(JSON.stringify(replay)));
});
describe("opening source authorization and delivery", () => {
  it("reports storage failures as unavailable rather than claiming no training data exists", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.artifact.mockRejectedValue(new Error("secret-storage-path"));
      const { openingCatalog, startOpening } = await import("./server");
      const catalog = await openingCatalog();
      await expect(
        startOpening({ legend: catalog.legends[0] }),
      ).rejects.toMatchObject({ status: 503 });
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "secret-storage-path",
      );
    } finally {
      warning.mockRestore();
    }
  });
  it("includes unlisted games anonymously and unlocks exactly one next question", async () => {
    const { openingCatalog, startOpening, revealOpening } =
      await import("./server");
    const catalog = await openingCatalog();
    expect(catalog.legends).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain("secret-");
    const question = await startOpening({ legend: catalog.legends[0] });
    expect(question.turn).toBe(1);
    expect(question.replay.events).toHaveLength(1);
    expect(JSON.stringify(question)).not.toContain("secret-");
    const answer = await revealOpening(question.token);
    expect(answer.next?.turn).toBe(2);
    expect(answer.next?.replay.events).toHaveLength(1);
    expect(JSON.stringify(answer)).not.toContain("secret-");
  });
  it("rechecks visibility even when the source and replay are cached", async () => {
    const { openingCatalog, startOpening, revealOpening } =
      await import("./server");
    const catalog = await openingCatalog(),
      question = await startOpening({ legend: catalog.legends[0] });
    mocks.data.visibility = "private";
    await expect(revealOpening(question.token)).rejects.toMatchObject({
      status: 410,
    });
    await expect(
      startOpening({ legend: catalog.legends[0] }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("excludes private sources from the shared pool", async () => {
    mocks.data.visibility = "private";
    const { openingCatalog } = await import("./server");
    expect((await openingCatalog()).legends).toEqual([]);
    expect(mocks.artifact).not.toHaveBeenCalled();
  });
  it("rejects a changed source revision", async () => {
    const { openingCatalog, startOpening, revealOpening } =
      await import("./server");
    const catalog = await openingCatalog(),
      question = await startOpening({ legend: catalog.legends[0] });
    mocks.data.canonicalArtifact = { sha256: "revision-2" };
    await expect(revealOpening(question.token)).rejects.toMatchObject({
      status: 409,
    });
  });
});
