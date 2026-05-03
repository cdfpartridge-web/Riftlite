import Link from "next/link";

import { AdSlot } from "@/components/site/ad-slot";
import { NewsCard } from "@/components/site/news-card";
import { SectionHeading } from "@/components/site/section-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getAdSlots, getNewsPosts } from "@/lib/sanity/content";
import { createPageMetadata } from "@/lib/seo";
import { formatDate } from "@/lib/utils";

export const revalidate = 60;

export const metadata = createPageMetadata({
  title: "RiftLite News",
  description:
    "Read RiftLite updates, Riftbound meta shifts, feature releases, patch notes, and community announcements.",
  path: "/news",
});

export default async function NewsPage() {
  const [posts, adSlots] = await Promise.all([getNewsPosts(), getAdSlots()]);
  const featured = posts[0];

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-6 py-12">
      <SectionHeading
        eyebrow="News"
        headingLevel={1}
        title="Patch notes, meta shifts, and announcements"
        description="Everything new in Riftbound and RiftLite — written for players, kept current."
      />

      {featured ? (
        <Link href={`/news/${featured.slug}`} className="block group">
          <Card className="space-y-5 transition-colors group-hover:border-white/20">
            <div className="flex items-center justify-between gap-3">
              <Badge>Featured</Badge>
              <time className="text-xs uppercase tracking-[0.16em] text-slate-500">
                {formatDate(featured.publishedAt)}
              </time>
            </div>
            <CardTitle className="text-3xl leading-snug group-hover:text-cyan-300 transition-colors">
              {featured.title}
            </CardTitle>
            <CardDescription className="text-base leading-relaxed">
              {featured.excerpt}
            </CardDescription>
            {featured.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {featured.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 group-hover:text-cyan-200 transition-colors">
              Read article <span className="text-base leading-none">→</span>
            </span>
          </Card>
        </Link>
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
