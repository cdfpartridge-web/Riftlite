import { ReplayCombiner } from "@/components/replay-v2/combine/ReplayCombiner";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Combine Replays",
  description: "Combine two consented RiftLite Atlas replay perspectives into one unlisted replay saved to your library.",
  path: "/replays/combine",
});

export default function CombineReplaysPage() {
  return <ReplayCombiner />;
}
