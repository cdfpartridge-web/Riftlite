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
    <div className="mx-auto max-w-[1900px] space-y-4 px-2 py-2 sm:px-3">
      <RiftReplayViewer />
    </div>
  );
}
