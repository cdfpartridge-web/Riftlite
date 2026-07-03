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
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <RiftReplayViewer initialReplayId={replayId} />
    </div>
  );
}
