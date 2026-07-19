import type { Metadata } from "next";

import { RiftLiteAuthPanel } from "@/components/site/riftlite-auth-panel";
import { SectionHeading } from "@/components/site/section-heading";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account | RiftLite",
  description: "Create, finish, or manage your RiftLite account.",
};

export default function AccountPage() {
  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="RiftLite account"
        headingLevel={1}
        title="One account for everything"
        description="Your app, private hubs, Discord verification, and web replays use the same RiftLite identity."
      />
      <RiftLiteAuthPanel actionLabel="Finish account" manageAccount />
    </div>
  );
}
