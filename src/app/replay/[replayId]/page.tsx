import { RiftReplayViewer } from "@/components/site/riftreplay-viewer";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type ReplayIdPageProps = {
  params: Promise<{ replayId: string }>;
};

export async function generateMetadata({ params }: ReplayIdPageProps) {
  const { replayId } = await params;
  return createPageMetadata({
    title: `RiftLite Replay ${replayId}`,
    description: "Load a RiftLite raw Atlas capture into the web replay viewer.",
    path: `/replay/${encodeURIComponent(replayId)}`,
  });
}

export default async function ReplayIdPage({ params }: ReplayIdPageProps) {
  const { replayId } = await params;
  return (
    <div className="h-screen overflow-hidden bg-[#05070b]">
      <RiftReplayViewer fullScreen initialReplayId={replayId} />
    </div>
  );
}
