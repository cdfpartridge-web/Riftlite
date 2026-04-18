import { SectionHeading } from "@/components/site/section-heading";
import { Card } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow="Privacy"
        title="Public pages are read-only; community data comes from shared match records."
        description="This starter policy text should be reviewed and tailored before launch, but it gives the site a clear, professional baseline."
      />
      <Card className="space-y-4 text-slate-300">
        <p>
          RiftLite publishes community match data that has been intentionally synced from the desktop app to a public collection.
        </p>
        <p>
          The website does not provide public write access, user accounts, or comments in v1.
        </p>
        <p>
          Operational analytics, hosting logs, Twitch embeds, and sponsor placements may involve third-party services when configured.
        </p>
      </Card>
    </div>
  );
}
