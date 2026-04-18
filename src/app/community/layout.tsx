import { CommunityNav } from "@/components/site/community-nav";
import { AdSlot } from "@/components/site/ad-slot";
import { getAdSlots } from "@/lib/sanity/content";

export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const adSlots = await getAdSlots();

  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <CommunityNav />
      <div>{children}</div>
    </div>
  );
}
