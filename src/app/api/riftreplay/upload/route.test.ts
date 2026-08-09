import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  getFirestoreAdmin: vi.fn(),
  requireReplayUser: vi.fn(),
  optionalReplayUser: vi.fn(),
  canonicalIdentityUid: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: mocks.get,
  put: mocks.put,
}));

vi.mock("@/lib/firebase/admin", () => ({
  getFirestoreAdmin: mocks.getFirestoreAdmin,
}));

vi.mock("@/lib/replay-v2-server", () => ({
  optionalReplayUser: mocks.optionalReplayUser,
  requireReplayUser: mocks.requireReplayUser,
  replayApiError: (error: unknown) => Response.json({ error: (error as Error).message }, { status: 401 }),
}));

vi.mock("@/lib/identity-server", () => ({
  canonicalIdentityUid: mocks.canonicalIdentityUid,
}));

import { GET } from "@/app/api/riftreplay/[replayId]/route";
import { POST } from "@/app/api/riftreplay/upload/route";
import { readCompressedPayload, storeCompressedPayload } from "@/lib/riftreplay-storage";

describe("legacy replay storage hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    mocks.optionalReplayUser.mockResolvedValue("owner-1");
    mocks.canonicalIdentityUid.mockImplementation(async (uid: string) => uid);
  });

  it("stores new legacy payloads in private Blob without persisting a public URL", async () => {
    mocks.put.mockResolvedValue({
      url: "https://public.example/should-not-be-saved",
      pathname: "replays/replay-1.json.gz",
    });
    const compressed = Buffer.from("private replay bytes");

    const stored = await storeCompressedPayload("replay-1", compressed, compressed.toString("base64"));

    expect(mocks.put).toHaveBeenCalledWith("replays/replay-1.json.gz", compressed, expect.objectContaining({
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
    }));
    expect(stored).toMatchObject({
      provider: "vercel-blob-private",
      blobUrl: "",
      blobPath: "replays/replay-1.json.gz",
      chunks: [],
    });
  });

  it("reads a private legacy payload through authenticated Blob access", async () => {
    const expected = Buffer.from("private replay bytes");
    const stream = new Response(expected).body;
    if (!stream) throw new Error("Expected a response body stream.");
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream,
    });
    const docRef = {} as Parameters<typeof readCompressedPayload>[0];

    await expect(readCompressedPayload(docRef, {
      storageProvider: "vercel-blob-private",
      blobPath: "replays/replay-1.json.gz",
    })).resolves.toEqual(expected);
    expect(mocks.get).toHaveBeenCalledWith("replays/replay-1.json.gz", { access: "private" });
  });

  it("rejects upload credentials before reading or writing replay data", async () => {
    mocks.requireReplayUser.mockRejectedValue(new Error("authentication_required"));

    const response = await POST(new Request("https://www.riftlite.com/api/riftreplay/upload", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(401);
    expect(mocks.getFirestoreAdmin).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("lets a canonical account read a private replay owned by one of its historical aliases", async () => {
    const compressed = gzipSync(Buffer.from(JSON.stringify({ schema: "riftlite-replay" }), "utf8"));
    const replayRef = {};
    mocks.getFirestoreAdmin.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({
              replayId: "replay-1",
              visibility: "private",
              ownerUid: "legacy-owner",
              storageProvider: "vercel-blob-private",
              blobPath: "replays/replay-1.json.gz",
            }),
            ref: replayRef,
          }),
        }),
      }),
    });
    mocks.canonicalIdentityUid.mockResolvedValue("owner-1");
    const stream = new Response(compressed).body;
    if (!stream) throw new Error("Expected a response body stream.");
    mocks.get.mockResolvedValue({ statusCode: 200, stream });

    const response = await GET(
      new Request("https://www.riftlite.com/api/riftreplay/replay-1") as never,
      { params: Promise.resolve({ replayId: "replay-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.canonicalIdentityUid).toHaveBeenCalledWith("legacy-owner", expect.anything());
  });
});
