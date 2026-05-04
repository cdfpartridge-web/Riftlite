import { AccountLinkClient } from "@/components/site/account-link-client";
import { SectionHeading } from "@/components/site/section-heading";

export const dynamic = "force-dynamic";

export default async function LinkDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; code?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.session ?? "";
  const code = params.code ?? "";

  return (
    <div className="space-y-8 py-10">
      <SectionHeading
        eyebrow="RiftLite Account"
        title="Link your desktop app"
        description="Use your RiftLite profile across the desktop app, web profiles, and private hubs."
      />
      {sessionId && code ? (
        <AccountLinkClient code={code} sessionId={sessionId} />
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-slate-300">
          This link is missing a desktop session. Start account linking from the RiftLite app.
        </p>
      )}
    </div>
  );
}
