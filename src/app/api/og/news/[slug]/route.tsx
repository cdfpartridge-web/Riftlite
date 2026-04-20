import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

async function fetchPost(slug: string) {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  if (!projectId) return null;

  const query = encodeURIComponent(
    `*[_type == "newsPost" && slug.current == $slug][0]{ title, excerpt, tags, publishedAt }`,
  );
  const url = `https://${projectId}.api.sanity.io/v2026-03-01/data/query/${dataset}?query=${query}&$slug=${encodeURIComponent(JSON.stringify(slug))}`;

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { title?: string; excerpt?: string; tags?: string[] } };
    return json.result ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await fetchPost(slug);

  const title = post?.title ?? "RiftLite Meta Report";
  const excerpt = post?.excerpt ?? "Weekly meta insights for Riftbound players.";
  const tags: string[] = post?.tags ?? [];

  // Strip the week tag (e.g. "2026-W17") to show as the eyebrow label
  const weekTag = tags.find((t) => /^\d{4}-W\d{1,2}$/.test(t));
  const eyebrow = weekTag ? `Week ${weekTag.replace(/^\d{4}-W0?/, "")} · ${weekTag.slice(0, 4)}` : "RiftLite";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "linear-gradient(135deg, #0d1424 0%, #0f172a 50%, #0d1f2d 100%)",
          display: "flex",
          flexDirection: "column",
          padding: "64px",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative glow top-right */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            right: "-120px",
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)",
          }}
        />
        {/* Decorative glow bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: "-80px",
            left: "-80px",
            width: "320px",
            height: "320px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
          }}
        />

        {/* Top bar: logo + eyebrow */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "48px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#06b6d4",
                boxShadow: "0 0 12px #06b6d4",
              }}
            />
            <span style={{ color: "#06b6d4", fontSize: "18px", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              RiftLite
            </span>
          </div>
          <span
            style={{
              color: "#94a3b8",
              fontSize: "16px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            color: "#f8fafc",
            fontSize: title.length > 50 ? "44px" : "52px",
            fontWeight: 800,
            lineHeight: 1.15,
            marginBottom: "24px",
            flex: 1,
          }}
        >
          {title}
        </div>

        {/* Excerpt */}
        <div
          style={{
            color: "#94a3b8",
            fontSize: "22px",
            lineHeight: 1.5,
            marginBottom: "40px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {excerpt}
        </div>

        {/* Bottom bar: tags + domain */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                style={{
                  background: "rgba(6,182,212,0.12)",
                  border: "1px solid rgba(6,182,212,0.3)",
                  borderRadius: "999px",
                  color: "#67e8f9",
                  fontSize: "14px",
                  padding: "4px 14px",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <span style={{ color: "#475569", fontSize: "16px" }}>riftlite.com</span>
        </div>
      </div>
    ),
    { ...SIZE },
  );
}
