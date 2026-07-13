import Head from "next/head";

import { ReplayLibrary } from "@/components/replay-v2/library/ReplayLibrary";

export default function EmbeddedReplayLibraryPage() {
  return (
    <>
      <Head>
        <title>RiftLite web replay</title>
        <meta content="noindex,nofollow" name="robots" />
      </Head>
      <ReplayLibrary embedded />
    </>
  );
}
