import type { Metadata } from "next";

import { ScorepadClient } from "@/components/site/scorepad-client";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Scorepad",
  description:
    "Offline-first RiftLite Scorepad for table games, Nexus Nights, and skirmishes, with canonical legend and battlefield logging.",
  path: "/scorepad",
});

export default function ScorepadPage() {
  return <ScorepadClient />;
}
