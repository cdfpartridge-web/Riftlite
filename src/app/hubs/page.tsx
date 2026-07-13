import type { Metadata } from "next";

import { MyHubsClient } from "@/components/site/my-hubs-client";
import { SectionHeading } from "@/components/site/section-heading";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Hubs | RiftLite",
  description: "Open your RiftLite private hubs and account-linked testing groups.",
};

export default function MyHubsPage() {
  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="Private hubs"
        headingLevel={1}
        title="My Hubs"
        description="Your memberships, roles, exact hub IDs, and RiftLite app shortcuts in one place."
      />
      <MyHubsClient />
    </div>
  );
}
