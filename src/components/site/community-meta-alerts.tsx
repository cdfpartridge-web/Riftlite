import { MetaAlertsStrip } from "@/components/site/meta-alerts-strip";
import { getCommunityMetaAlerts } from "@/lib/community/service";

/**
 * Server-component wrapper that fetches the community meta-alert window
 * and renders the strip. Mount on the five overview pages where the
 * "what's shifting?" framing is useful (leaderboard, meta, matrix,
 * matches list, decks list) — not on detail pages where the visitor
 * has already drilled in past the alerts.
 */
export async function CommunityMetaAlerts() {
  const alerts = await getCommunityMetaAlerts();
  return <MetaAlertsStrip alerts={alerts} />;
}
