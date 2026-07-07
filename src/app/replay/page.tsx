import { redirect } from "next/navigation";

import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "RiftLite Replay Viewer",
  description:
    "Inspect RiftLite raw Atlas captures with a replay-style timeline, board state, player zones, cards, and diagnostics.",
  path: "/replay",
});

export default function ReplayPage() {
  redirect("/replays");
}
