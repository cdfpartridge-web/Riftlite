import { PortableText } from "@portabletext/react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdSlot } from "@/components/site/ad-slot";
import { DiscordCta } from "@/components/site/discord-cta";
import { SectionHeading } from "@/components/site/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdSlots, getNewsPostBySlug, getSiteSettings } from "@/lib/sanity/content";
import { formatDate } from "@/lib/utils";

export const revalidate = 60;

export default async function NewsPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, adSlots, settings] = await Promise.all([
    getNewsPostBySlug(slug),
    getAdSlots(),
    getSiteSettings(),
  ]);

  if (!post) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow={formatDate(post.publishedAt)}
        title={post.title}
        description={post.excerpt}
      />
      <Button asChild variant="secondary">
        <Link href="/news">Back to news</Link>
      </Button>
      <Card className="prose prose-invert max-w-none prose-p:text-slate-300 prose-headings:text-white">
        <PortableText value={post.body as never} />
      </Card>
      <DiscordCta
        body="Got thoughts on this article? Dive into the discussion with other Riftbound players in the RiftLite Discord."
        href={settings.discordUrl}
        title="Keep the conversation going"
        variant="card"
      />
      <AdSlot placement="news-footer" slots={adSlots} />
    </div>
  );
}
