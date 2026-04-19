import { CommunityNav } from "@/components/site/community-nav";
import { MetaAlertsStrip } from "@/components/site/meta-alerts-strip";
import { getCommunityMetaAlerts } from "@/lib/community/service";

export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const alerts = await getCommunityMetaAlerts();

  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <CommunityNav />
      <MetaAlertsStrip alerts={alerts} />
      <div>{children}</div>
    </div>
  );
}
