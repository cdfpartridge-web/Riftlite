// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  start: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock("@/lib/opening-lab/server", () => ({
  OpeningLabError: class extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
  openingCatalog: mocks.catalog,
  startOpening: mocks.start,
  revealOpening: mocks.reveal,
}));
import { GET, POST } from "./route";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost:4201/api/opening-lab", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue({ legends: ["Shen"] });
  mocks.start.mockResolvedValue({ token: "opaque", turn: 1 });
  mocks.reveal.mockResolvedValue({ next: null });
});
describe("opening practice API boundary", () => {
  it("keeps catalog and questions out of shared caches", async () => {
    const catalog = await GET(),
      question = await post(
        { action: "start", legend: "Shen" },
        { host: "127.0.0.1:4201", origin: "http://127.0.0.1:4201" },
      );
    expect(question.status).toBe(200);
    for (const response of [catalog, question])
      expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.start).toHaveBeenCalledWith({
      legend: "Shen",
      opponent: undefined,
    });
  });
  it("requires an explicit lock to reveal", async () => {
    expect((await post({ action: "reveal", token: "opaque" })).status).toBe(
      400,
    );
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(
      (await post({ action: "reveal", token: "opaque", locked: true })).status,
    ).toBe(200);
    expect(mocks.reveal).toHaveBeenCalledWith("opaque");
  });
  it("rejects cross-origin requests, malformed bodies and oversized streams before loading a source", async () => {
    expect(
      (
        await post(
          { action: "start", legend: "Shen" },
          { origin: "https://elsewhere.invalid" },
        )
      ).status,
    ).toBe(403);
    expect((await post("invalid")).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post("x".repeat(4097))).status).toBe(413);
    expect((await post({}, { "content-type": "text/plain" })).status).toBe(415);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.reveal).not.toHaveBeenCalled();
  });
  it("does not expose source paths or account details from unexpected failures", async () => {
    mocks.start.mockRejectedValueOnce(
      new Error("secret-owner /storage/private-replay"),
    );
    const response = await post({ action: "start", legend: "Shen" });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-owner");
  });
});
