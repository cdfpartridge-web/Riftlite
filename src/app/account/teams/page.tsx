import type { Metadata } from "next";
import { MyTeamsClient } from "@/components/site/my-teams-client";
import { SectionHeading } from "@/components/site/section-heading";

export const metadata: Metadata = {
  title: "My Teams | RiftLite",
  description: "Your teams and invitations.",
  robots: { index: false, follow: false },
};

export default function MyTeamsPage() {
  return <div className="space-y-8 py-10">
    <SectionHeading eyebrow="RiftLite teams" headingLevel={1} title="My Teams" description="Accept invitations, find your teams and invite your next teammate." />
    <MyTeamsClient />
  </div>;
}
