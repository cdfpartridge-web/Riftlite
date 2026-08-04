import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  requireMetaStudioSession: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
}));

vi.mock("@/lib/community/meta-studio-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/meta-studio-auth")>();
  return {
    ...actual,
    requireMetaStudioSession: mocks.requireMetaStudioSession,
  };
});

import { GET, PUT } from "@/app/api/meta-studio/creator-videos/route";
import {
  CREATOR_VIDEO_FEED_CACHE_TAG,
  communitySpotlightVideoProfilesFromConfig,
  creatorVideoCarouselStorageFromConfig,
  normalizeCreatorVideoCarouselConfig,
} from "@/lib/youtube/creator-video-config";

function authorizedDb() {
  return {
    collection: vi.fn((collection: string) => {
      expect(collection).toBe("app_config");
      return {
        doc: vi.fn((document: string) => {
          expect(document).toBe("home");
          return { get: mocks.get, set: mocks.set };
        }),
      };
    }),
  };
}

describe("Meta Studio creator video carousel route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ exists: false, data: () => undefined });
    mocks.set.mockResolvedValue(undefined);
    mocks.requireMetaStudioSession.mockResolvedValue({
      uid: "canonical-bmu",
      decoded: { uid: "canonical-bmu" },
      db: authorizedDb(),
    });
  });

  it("loads and strictly normalizes the private Firestore configuration", async () => {
    mocks.get.mockResolvedValue({
      exists: true,
      data: () => ({
        creatorVideoCarouselUpdatedAt: 1234,
        communitySpotlights: [{
          id: "riftlab",
          name: "Riftlab social profile",
          enabled: true,
          links: { youtube: "youtube.com/@RiftlabTCG/videos" },
          channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
        }],
        creatorVideoCarousel: {
          enabled: false,
          rotationSeconds: 2,
          maxItems: 999,
          excludedVideoIds: ["abcdefghijk", "bad"],
          creators: [{
            id: "riftlab",
            videoSlots: 99,
          }],
        },
      }),
    });

    const response = await GET(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/creator-videos",
      { headers: { Cookie: "riftlite_meta_studio=signed" } },
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload.updatedAt).toBe(1234);
    expect(payload.config).toEqual(normalizeCreatorVideoCarouselConfig({
      enabled: false,
      rotationSeconds: 2,
      maxItems: 999,
      excludedVideoIds: ["abcdefghijk", "bad"],
      creators: [{
        id: "riftlab",
        videoSlots: 99,
      }],
    }, [{
      id: "riftlab",
      name: "Riftlab social profile",
      enabled: true,
      links: { youtube: "youtube.com/@RiftlabTCG/videos" },
      channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
    }]));
  });

  it("merge-saves only the normalized carousel and revalidates desktop Home", async () => {
    const requestConfig = {
      enabled: true,
      rotationSeconds: 17.8,
      maxItems: 7,
      pinnedVideoIds: ["12345678901", "bad"],
      excludedVideoIds: ["abcdefghijk"],
      creators: [{
        id: "creator-one",
        name: "Creator One",
        spotlightId: "creator-one",
        youtubeUrl: "https://www.youtube.com/@CreatorOne",
        channelId: "UCDQDmAPxp49TXOK9ZjLbCuA",
        enabled: true,
        videoSlots: 3.4,
      }],
    };
    const response = await PUT(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/creator-videos",
      {
        method: "PUT",
        headers: {
          Cookie: "riftlite_meta_studio=signed",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config: requestConfig }),
      },
    ));
    const payload = await response.json();
    const normalized = normalizeCreatorVideoCarouselConfig(requestConfig);

    expect(response.status).toBe(200);
    expect(payload.config).toEqual(normalized);
    expect(payload.message).toMatch(/saved/i);
    expect(mocks.set).toHaveBeenCalledWith({
      communitySpotlights: communitySpotlightVideoProfilesFromConfig(normalized),
      creatorVideoCarousel: creatorVideoCarouselStorageFromConfig(normalized),
      creatorVideoCarouselUpdatedAt: expect.any(Number),
      creatorVideoCarouselUpdatedBy: "canonical-bmu",
    }, { merge: true });
    expect(mocks.revalidateTag).toHaveBeenCalledWith(CREATOR_VIDEO_FEED_CACHE_TAG, "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/app/home");
  });

  it("rejects a missing configuration without changing Home", async () => {
    const response = await PUT(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/creator-videos",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not read or write Firestore without a Meta Studio session", async () => {
    mocks.requireMetaStudioSession.mockResolvedValue({
      error: NextResponse.json({ error: "Sign in" }, { status: 401 }),
    });

    const getResponse = await GET(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/creator-videos",
    ));
    const putResponse = await PUT(new NextRequest(
      "https://www.riftlite.com/api/meta-studio/creator-videos",
      { method: "PUT", body: JSON.stringify({ config: {} }) },
    ));

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
