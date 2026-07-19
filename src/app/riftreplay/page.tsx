import { RiftReplayViewer } from "@/components/site/riftreplay-viewer";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "RiftReplay Web Viewer",
  description:
    "Inspect RiftLite and RiftReplay raw Atlas captures with a replay-style timeline, board state, player zones, cards, and diagnostics.",
  path: "/riftreplay",
});

export default function RiftReplayPage() {
  return (
    <div className="h-screen overflow-hidden bg-[#05070b]">
      <RiftReplayViewer fullScreen />
    </div>
  );
}
