import { createClient } from "next-sanity";
import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest, NextResponse } from "next/server";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "";
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";

function getSanityWriteClient() {
  return createClient({
    projectId: projectId || "demo",
    dataset,
    apiVersion: "2026-03-01",
    useCdn: false,
    token: process.env.SANITY_API_TOKEN,
  });
}

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  created_utc: number;
  score: number;
}

function toPortableText(paragraphs: string[]) {
  return paragraphs.map((text) => ({
    _type: "block",
    style: "normal",
    markDefs: [] as unknown[],
    children: [{ _type: "span", text, marks: [] as string[] }],
  }));
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function fetchRedditPosts(): Promise<RedditPost[]> {
  const res = await fetch(
    "https://www.reddit.com/r/riftboundtcg/new.json?limit=25",
    {
      headers: { "User-Agent": "RiftLite-NewsSyncer/1.0" },
      cache: "no-store",
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { children?: { data: RedditPost }[] };
  };
  return (data?.data?.children ?? []).map((c) => c.data);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.NEWS_SYNC_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  // Accept "Bearer <secret>" or raw secret in x-news-sync-secret header
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers.get("x-news-sync-secret") === secret) return true;
  return false;
}

async function runSync() {
  if (!projectId) {
    return NextResponse.json({ error: "Sanity not configured" }, { status: 503 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const sanity = getSanityWriteClient();

  const posts = await fetchRedditPosts();
  if (!posts.length) {
    return NextResponse.json({ created: 0, skipped: 0, message: "No posts fetched" });
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const post of posts) {
    const docId = `reddit-${post.id}`;
    const draftId = `drafts.${docId}`;

    try {
      const [existingDraft, existingPublished] = await Promise.all([
        sanity.fetch<string | null>(`*[_id == $id][0]._id`, { id: draftId }),
        sanity.fetch<string | null>(`*[_id == $id][0]._id`, { id: docId }),
      ]);

      if (existingDraft || existingPublished) {
        skipped++;
        continue;
      }

      const postContent = [
        `Title: ${post.title}`,
        post.selftext ? `Body: ${post.selftext.slice(0, 2000)}` : "",
        `URL: https://reddit.com${post.permalink}`,
        `Upvotes: ${post.score}`,
      ]
        .filter(Boolean)
        .join("\n");

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `You are a news editor for RiftLite, a companion app for the Riftbound TCG (a card game by Riot Games).

Assess this Reddit post and decide if it is worth covering as a news article. Accept posts about:
- Riftbound TCG news, patches, or updates
- New card or set announcements
- Tournament results or community highlights
- Noteworthy strategy or gameplay discussions with good engagement

Reddit post:
${postContent}

If NOT relevant (memes, off-topic, spam, or trivial), respond with exactly: SKIP

If relevant, respond with a JSON object (no markdown, no code fences) in this exact shape:
{
  "title": "concise news headline",
  "excerpt": "2-3 sentence summary for the article preview",
  "paragraphs": ["paragraph one", "paragraph two", "paragraph three"],
  "tags": ["Riftbound", "tag2"]
}

Write the content as a short news article. Do not mention Reddit or the post author.`,
          },
        ],
      });

      const raw =
        message.content[0].type === "text" ? message.content[0].text.trim() : "";

      if (!raw || raw.toUpperCase().startsWith("SKIP")) {
        skipped++;
        continue;
      }

      let parsed: {
        title: string;
        excerpt: string;
        paragraphs: string[];
        tags: string[];
      };

      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        skipped++;
        continue;
      }

      if (!parsed.title || !parsed.excerpt || !Array.isArray(parsed.paragraphs)) {
        skipped++;
        continue;
      }

      const slug = slugify(parsed.title);
      const publishedAt = new Date(post.created_utc * 1000).toISOString();

      await sanity.createIfNotExists({
        _id: draftId,
        _type: "newsPost",
        title: parsed.title,
        slug: { _type: "slug", current: slug },
        excerpt: parsed.excerpt,
        publishedAt,
        body: toPortableText(parsed.paragraphs),
        tags: Array.isArray(parsed.tags) ? parsed.tags : ["Riftbound"],
        featured: false,
      });

      created++;
    } catch (err) {
      errors.push(`${post.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    created,
    skipped,
    total: posts.length,
    ...(errors.length ? { errors } : {}),
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}
