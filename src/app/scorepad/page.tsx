import type { Metadata } from "next";

import { ScorepadClient } from "@/components/site/scorepad-client";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...createPageMetadata({
    title: "RiftLite Scorepad",
    description:
      "Offline-first RiftLite Scorepad for table games, Nexus Nights, and skirmishes, with canonical legend and battlefield logging.",
    path: "/scorepad",
  }),
  applicationName: "RiftLite Scorepad",
  appleWebApp: {
    capable: true,
    title: "RiftLite Scorepad",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/brand/riftlite-logo-ui.png",
    apple: "/brand/riftlite-logo-ui.png",
  },
};

export default function ScorepadPage() {
  return <ScorepadClient />;
}
