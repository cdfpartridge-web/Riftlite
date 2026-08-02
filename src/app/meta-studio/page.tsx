import { cookies } from "next/headers";

import { MetaStudioClient } from "@/components/meta-studio/MetaStudioClient";
import {
  buildMetaStudioReport,
  type MetaStudioFilters,
} from "@/lib/community/meta-studio";
import {
  META_STUDIO_SESSION_COOKIE,
  verifyMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { FIXTURE_MATCHES } from "@/lib/fixtures/community";
import { createNoIndexMetadata } from "@/lib/seo";
import type { CommunityMatch } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = createNoIndexMetadata(
  "Private Meta Studio",
  "BMU's private RiftLite community meta reporting workspace.",
  "/meta-studio",
);

function localPreviewReport() {
  const now = Date.UTC(2026, 3, 19, 18);
  const dayMs = 24 * 60 * 60 * 1000;
  const expanded: CommunityMatch[] = [];

  for (let cycle = 0; cycle < 8; cycle += 1) {
    for (let index = 0; index < FIXTURE_MATCHES.length; index += 1) {
      const source = FIXTURE_MATCHES[index];
      expanded.push({
        ...source,
        id: `preview-current-${cycle}-${source.id}`,
        uid: `${source.uid}-${cycle}`,
        platform: cycle % 2 === 0 ? "atlas" : "tcga",
        createdAt: now - ((cycle * FIXTURE_MATCHES.length + index) * 52 * 60 * 1000),
      });
      expanded.push({
        ...source,
        id: `preview-previous-${cycle}-${source.id}`,
        uid: `${source.uid}-previous-${cycle}`,
        platform: cycle % 2 === 0 ? "atlas" : "tcga",
        createdAt: now - dayMs * 8 - ((cycle * FIXTURE_MATCHES.length + index) * 41 * 60 * 1000),
        result: cycle % 3 === 0
          ? source.result === "Win"
            ? "Loss"
            : "Win"
          : source.result,
      });
    }
  }

  const filters: MetaStudioFilters = {
    range: "7d",
    season: "",
    format: "all",
    platform: "all",
    minSample: 5,
  };
  return buildMetaStudioReport(expanded, filters, {
    now,
    sourcePeriodRecords: expanded.length / 2,
    comparisonAvailable: true,
  });
}

export default async function MetaStudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const preview =
    process.env.NODE_ENV === "development" &&
    String(params.preview ?? "") === "1";
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(META_STUDIO_SESSION_COOKIE)?.value ?? "";
  const principal = preview ? null : await verifyMetaStudioSession(sessionCookie);

  return (
    <MetaStudioClient
      initialAuthorized={Boolean(principal)}
      previewReport={preview ? localPreviewReport() : null}
    />
  );
}
