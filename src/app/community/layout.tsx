import { CommunityNav } from "@/components/site/community-nav";

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-screen-2xl space-y-8 px-6 py-12">
      <CommunityNav />
      <div>{children}</div>
    </div>
  );
}
