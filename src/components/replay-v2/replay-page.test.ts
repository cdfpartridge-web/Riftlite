import { describe, expect, it } from "vitest";

import { getServerSideProps } from "@/pages/replays/[replayId]";

describe("replay page server props", () => {
  it("does not turn an embed query into a private workspace", async () => {
    const result = await getServerSideProps({
      params: { replayId: "rl2_public_embed" },
      query: { embed: "1", privateHub: "1" },
    } as unknown as Parameters<typeof getServerSideProps>[0]);

    expect(result).toEqual({
      props: {
        embed: true,
        manageVisibility: false,
        replayId: "rl2_public_embed",
      },
    });
  });

  it("opens only the explicit visibility editor request without granting owner access", async () => {
    const result = await getServerSideProps({
      params: { replayId: "rl2_owner_replay" },
      query: { embed: "1", manage: "visibility" },
    } as unknown as Parameters<typeof getServerSideProps>[0]);
    expect(result).toEqual({ props: { replayId: "rl2_owner_replay", embed: true, manageVisibility: true } });
  });
});
