import Head from "next/head";
import { useRouter } from "next/router";

import { ReplayLibrary } from "@/components/replay-v2/library/ReplayLibrary";

export default function EmbeddedReplayLibraryPage() {
  const router = useRouter();
  const scope = router.query.scope === "reviews" ? "reviews" : "mine";
  return (
    <>
      <Head>
        <title>RiftLite web replay</title>
        <meta content="noindex,nofollow" name="robots" />
      </Head>
      {router.isReady ? <ReplayLibrary embedded initialScope={scope} key={scope} /> : null}
    </>
  );
}
