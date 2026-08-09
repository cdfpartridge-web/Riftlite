import { SectionHeading } from "@/components/site/section-heading";
import { Card } from "@/components/ui/card";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Cookie Policy",
  description:
    "Cookie information for RiftLite, including third-party services such as ads, analytics, and embeds when enabled.",
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow="Cookies"
        headingLevel={1}
        title="Cookie usage depends on the services you enable."
        description="RiftLite uses first- and third-party services to provide selected website and desktop features."
      />
      <Card className="space-y-4 text-slate-300">
        <p>
          When the live takeover is enabled and the configured Twitch channel is live, opening Home in RiftLite Desktop automatically loads an embedded Twitch player. The player starts muted, but Twitch still receives the normal connection and device information needed to deliver the stream and may read or set cookies or similar storage under Twitch&apos;s own policies.
        </p>
        <p>
          You can stop the embedded player by leaving Home or closing RiftLite. RiftLite&apos;s operator can also turn the takeover off through the private Meta Studio, which restores the normal creator-video carousel without a desktop update.
        </p>
        <p>
          Other optional third-party services, including analytics, advertising tools, or external community links, may use their own cookies or storage when those services are enabled or opened. Their own privacy and cookie policies apply.
        </p>
      </Card>
    </div>
  );
}
