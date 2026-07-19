import { ReplayLibrary } from "@/components/replay-v2/library/ReplayLibrary";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "RiftLite Replays",
  description: "Watch public RiftLite Atlas replays or privately upload a raw capture.",
  path: "/replays",
});

export default function ReplaysPage() {
  return <ReplayLibrary />;
}
