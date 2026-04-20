import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortableTextRenderer } from "@/components/site/portable-text-renderer";
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
  // coverImage is already a plain CDN URL from the GROQ projection.
  // Append Sanity's image transform params: resize, auto format, fill
  // transparent areas with the site background so PNGs don't go black.
  // No crop or fixed height — infographics and portrait images should
  // display at their natural proportions. Just cap the width so it
  // doesn't exceed the content column.
  const coverImageUrl = post.coverImage
    ? `${post.coverImage}?w=1200&auto=format&bg=0c1021`
    : null;

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

      {coverImageUrl && (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
          <Image
            src={coverImageUrl}
            alt={post.title}
            width={1200}
            height={900}
            style={{ height: "auto" }}
            className="w-full"
            priority
          />
        </div>
      )}

      <Card>
        <PortableTextRenderer value={post.body as unknown[]} />
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
