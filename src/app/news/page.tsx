import { PortableText } from "@portabletext/react";

import { AdSlot } from "@/components/site/ad-slot";
import { NewsCard } from "@/components/site/news-card";
import { SectionHeading } from "@/components/site/section-heading";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getAdSlots, getNewsPosts } from "@/lib/sanity/content";

export const revalidate = 60;

export default async function NewsPage() {
  const [posts, adSlots] = await Promise.all([getNewsPosts(), getAdSlots()]);
  const featured = posts[0];

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-6 py-12">
      <SectionHeading
        eyebrow="News"
        title="Patch notes, meta shifts, and announcements"
        description="Everything new in Riftbound and RiftLite — written for players, kept current."
      />

      {featured ? (
        <Card className="space-y-5">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Featured post
          </div>
          <CardTitle className="text-3xl">{featured.title}</CardTitle>
          <CardDescription>{featured.excerpt}</CardDescription>
          <div className="prose prose-invert max-w-none prose-p:text-slate-300">
            <PortableText value={featured.body as never} />
          </div>
        </Card>
      ) : null}

      <AdSlot placement="news-inline" slots={adSlots} />

      <div className="grid gap-6 lg:grid-cols-2">
        {posts.slice(1).map((post) => (
          <NewsCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
