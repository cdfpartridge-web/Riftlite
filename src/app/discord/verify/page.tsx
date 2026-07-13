import type { Metadata } from "next";

import { DiscordVerifyClient } from "@/components/site/discord-verify-client";
import { SectionHeading } from "@/components/site/section-heading";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discord Verification | RiftLite",
  description: "Verify your RiftLite account for a Discord testing server.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function DiscordVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const code = String(params.code ?? "").trim();

  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="Discord"
        headingLevel={1}
        title="Verify RiftLite"
        description="Link your Discord account to your RiftLite profile for private testing roles, hub leaderboards, and future Discord tools."
      />
      {code ? (
        <DiscordVerifyClient code={code} />
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-slate-300">
          This verification link is missing a code. Run <span className="font-semibold text-white">/verify</span> in Discord to create a fresh link.
        </div>
      )}
    </div>
  );
}
