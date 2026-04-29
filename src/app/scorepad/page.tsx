import type { Metadata } from "next";

import { ScorepadClient } from "@/components/site/scorepad-client";

export const metadata: Metadata = {
  title: "Scorepad | RiftLite",
  description: "Offline-first RiftLite Scorepad for table games, Nexus Nights, and skirmishes.",
};

export default function ScorepadPage() {
  return <ScorepadClient />;
}
