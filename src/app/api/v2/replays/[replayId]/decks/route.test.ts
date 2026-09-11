import { beforeEach, describe, expect, it, vi } from "vitest";
const { readMock, saveMock, bearerMock, viewerMock } = vi.hoisted(() => ({
  readMock: vi.fn(), saveMock: vi.fn(), bearerMock: vi.fn(), viewerMock: vi.fn()
}));
vi.mock("@/lib/replay-v2-server", async () => ({
  ...await vi.importActual<typeof import("@/lib/replay-v2-server")>("@/lib/replay-v2-server"),
  readOwnerReplayDecks: readMock, saveOwnerReplayDecks: saveMock,
  requireReplayUser: bearerMock, requireReplayViewerUser: viewerMock
}));
import { GET, PUT } from "./route";
import { ReplayV2Error } from "@/lib/replay-v2-server/errors";
const id = "rl2_" + "d".repeat(32);
const context = { params: Promise.resolve({ replayId: id }) };
const url = "https://www.riftlite.com/api/v2/replays/" + id + "/decks";

describe("private match-deck endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); viewerMock.mockResolvedValue("owner"); bearerMock.mockResolvedValue("owner"); readMock.mockResolvedValue(null); });
  it("uses the existing signed-in/embed viewer identity and returns an uncached owner-only response", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(viewerMock).toHaveBeenCalledOnce();
    expect(readMock).toHaveBeenCalledWith("owner", id);
  });
  it("requires a bearer credential for writes even when an embed cookie could read", async () => {
    bearerMock.mockRejectedValueOnce(new ReplayV2Error(401, "authentication_required", "Bearer required."));
    const response = await PUT(new Request(url, { method: "PUT", body: JSON.stringify({ matchId: "match", history: {} }) }), context);
    expect(response.status).toBe(401);
    expect(viewerMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
  it("bounds the request body and validates match identity before calling the writer", async () => {
    const large = await PUT(new Request(url, { method: "PUT", body: "x".repeat(128_001) }), context);
    expect(large.status).toBe(413);
    const missing = await PUT(new Request(url, { method: "PUT", body: "{}" }), context);
    expect(missing.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
    const valid = await PUT(new Request(url, { method: "PUT", body: JSON.stringify({ matchId: "match", history: { version: 1 } }) }), context);
    expect(valid.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith("owner", id, "match", { version: 1 });
  });
});
