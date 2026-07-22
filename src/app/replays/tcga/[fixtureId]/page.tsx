import { notFound } from "next/navigation";

import { ReplayV2Player } from "@/components/replay-v2";
import {
  LOCAL_TCGA_FIXTURE_ID_PATTERN,
  localTcgaReplayPreviewEnabled,
} from "@/lib/local-tcga-replay-preview";

export const dynamic = "force-dynamic";

type LocalTcgaReplayPageProps = {
  params: Promise<{ fixtureId: string }>;
};

export default async function LocalTcgaReplayPage({ params }: LocalTcgaReplayPageProps) {
  const { fixtureId } = await params;
  if (!localTcgaReplayPreviewEnabled() || !LOCAL_TCGA_FIXTURE_ID_PATTERN.test(fixtureId)) {
    notFound();
  }

  return (
    <main style={{ minHeight: "100vh", background: "#05070b" }}>
      <ReplayV2Player
        replayId={fixtureId}
        apiBasePath="/api/local/tcga-replays"
      />
    </main>
  );
}
