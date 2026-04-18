import { SectionHeading } from "@/components/site/section-heading";
import { Card } from "@/components/ui/card";

export default function CookiesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow="Cookies"
        title="Cookie usage depends on the services you enable."
        description="This page is ready for launch and should be updated with the final provider list once analytics, ads, and embeds are confirmed."
      />
      <Card className="space-y-4 text-slate-300">
        <p>
          Core pages can operate without cookies, but third-party services like Twitch embeds, analytics, or ad networks may set their own cookies.
        </p>
        <p>
          If you enable AdSense or other advertising tools, update this page with the exact provider disclosures before launch.
        </p>
      </Card>
    </div>
  );
}
