import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import Head from "next/head";

import { ReplayV2Player } from "@/components/replay-v2";

type ReplayPageProps = {
  embed: boolean;
  replayId: string;
};

export const getServerSideProps: GetServerSideProps<ReplayPageProps> = async ({ params, query }) => {
  const rawReplayId = params?.replayId;
  const replayId = Array.isArray(rawReplayId) ? rawReplayId[0] : rawReplayId;
  if (!replayId || replayId.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(replayId)) {
    return { notFound: true };
  }
  const embedValue = Array.isArray(query.embed) ? query.embed[0] : query.embed;
  return {
    props: {
      embed: embedValue === "1" || embedValue === "true",
      replayId,
    },
  };
};

export default function ReplayPage({
  embed,
  replayId,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const canonicalPath = `/replays/${encodeURIComponent(replayId)}`;
  return (
    <>
      <Head>
        <title>{`RiftLite Replay ${replayId}`}</title>
        <meta
          content="Watch a deterministic, turn-by-turn Riftbound replay in RiftLite."
          name="description"
        />
        <link href={canonicalPath} rel="canonical" />
        {embed ? <meta content="noindex,nofollow" name="robots" /> : null}
      </Head>
      <ReplayV2Player embed={embed} replayId={replayId} />
    </>
  );
}
