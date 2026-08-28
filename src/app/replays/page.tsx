import { ReplayLibrary } from "@/components/replay-v2/library/ReplayLibrary";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "RiftLite Replays",
  description: "Watch public RiftLite replays, upload a private capture, or combine two consented Atlas perspectives.",
  path: "/replays",
});

type ReplaysPageProps = {
  searchParams: Promise<{ scope?: string | string[] }>;
};

export default async function ReplaysPage({ searchParams }: ReplaysPageProps) {
  const params = await searchParams;
  const scope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  return <ReplayLibrary initialScope={scope === "mine" ? "mine" : "public"} />;
}
