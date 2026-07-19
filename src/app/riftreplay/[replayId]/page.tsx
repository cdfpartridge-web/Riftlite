import { RiftReplayViewer } from "@/components/site/riftreplay-viewer";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type RiftReplayIdPageProps = {
  params: Promise<{ replayId: string }>;
};

export async function generateMetadata({ params }: RiftReplayIdPageProps) {
  const { replayId } = await params;
  return createPageMetadata({
    title: `RiftReplay ${replayId}`,
    description: "Load a private RiftReplay capture into the RiftLite web replay viewer.",
    path: `/riftreplay/${encodeURIComponent(replayId)}`,
  });
}

export default async function RiftReplayIdPage({ params }: RiftReplayIdPageProps) {
  const { replayId } = await params;
  return (
    <div className="h-screen overflow-hidden bg-[#05070b]">
      <RiftReplayViewer fullScreen initialReplayId={replayId} />
    </div>
  );
}
