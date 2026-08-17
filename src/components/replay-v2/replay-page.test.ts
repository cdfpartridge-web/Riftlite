import { describe, expect, it } from "vitest";

import { getServerSideProps } from "@/pages/replays/[replayId]";

describe("replay page server props", () => {
  it("does not turn an embed query into a private workspace", async () => {
    const result = await getServerSideProps({
      params: { replayId: "rl2_public_embed" },
      query: { embed: "1", privateHub: "1" },
    } as Parameters<typeof getServerSideProps>[0]);

    expect(result).toEqual({
      props: {
        embed: true,
        replayId: "rl2_public_embed",
      },
    });
  });
});
