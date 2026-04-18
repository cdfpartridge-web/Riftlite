import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { NewsPost } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type NewsCardProps = {
  post: NewsPost;
};

export function NewsCard({ post }: NewsCardProps) {
  return (
    <Card className="card-hover flex h-full flex-col justify-between gap-5">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Badge>{post.featured ? "Featured" : "News"}</Badge>
          <time className="text-xs uppercase tracking-[0.16em] text-slate-500">
            {formatDate(post.publishedAt)}
          </time>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-lg leading-snug">{post.title}</CardTitle>
          <CardDescription className="line-clamp-3">{post.excerpt}</CardDescription>
        </div>
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-400"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 transition-colors hover:text-cyan-200"
        href={`/news/${post.slug}`}
      >
        Read update <span className="text-base leading-none">→</span>
      </Link>
    </Card>
  );
}
