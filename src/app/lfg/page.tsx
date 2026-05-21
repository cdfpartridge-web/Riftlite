import type { Metadata } from "next";

import { LfgClient } from "@/components/site/lfg-client";
import { SectionHeading } from "@/components/site/section-heading";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find Match | RiftLite",
  description: "Post or browse short-lived RiftLite room codes for TCGA and RiftAtlas games.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LfgPage() {
  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow="Social Hub"
        headingLevel={1}
        title="Find Match"
        description="Post a room code for a quick test game, or copy an active code from another signed-in RiftLite player."
      />
      <LfgClient />
    </div>
  );
}
