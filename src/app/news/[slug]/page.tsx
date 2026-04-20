import type { Metadata } from "next";
import { PortableText } from "@portabletext/react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdSlot } from "@/components/site/ad-slot";
import { DiscordCta } from "@/components/site/discord-cta";
import { SectionHeading } from "@/components/site/section-heading";
import { ShareButton } from "@/components/site/share-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdSlots, getNewsPostBySlug, getSiteSettings } from "@/lib/sanity/content";
import { formatDate } from "@/lib/utils";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getNewsPostBySlug(slug);
  if (!post) return {};

  const ogImage = `/api/og/news/${slug}`;

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.publishedAt,
      tags: post.tags,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: [ogImage],
    },
  };
}

export default async function NewsPostPage({ params }: Props) {
  const { slug } = await params;
  const [post, adSlots, settings] = await Promise.all([
    getNewsPostBySlug(slug),
    getAdSlots(),
    getSiteSettings(),
  ]);

  if (!post) {
    notFound();
  }

  const url = `https://www.riftlite.com/news/${slug}`;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <SectionHeading
        eyebrow={formatDate(post.publishedAt)}
        title={post.title}
        description={post.excerpt}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="secondary">
          <Link href="/news">← Back to news</Link>
        </Button>
        <ShareButton url={url} title={post.title} />
      </div>

      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <Card className="prose prose-invert max-w-none prose-p:text-slate-300 prose-headings:text-white prose-li:text-slate-300 prose-strong:text-white">
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
