import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import {
  CasterStudioPlayer,
  parseCasterReplayReference,
} from "@/components/replay-v2/caster";
import {
  META_STUDIO_SESSION_COOKIE,
  verifyMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { createNoIndexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = createNoIndexMetadata(
  "RiftLite Caster Studio Replay",
  "A private RiftLite replay presentation workspace.",
  "/meta-studio/caster",
);

export default async function CasterStudioReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ replayId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ replayId: rawReplayId }, query] = await Promise.all([params, searchParams]);
  const replayId = parseCasterReplayReference(rawReplayId);
  if (!replayId) notFound();

  const preview = process.env.NODE_ENV === "development" && String(query.preview ?? "") === "1";
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(META_STUDIO_SESSION_COOKIE)?.value ?? "";
  const principal = preview ? null : await verifyMetaStudioSession(sessionCookie);

  return (
    <CasterStudioPlayer
      initialAuthorized={Boolean(principal)}
      preview={preview}
      replayId={replayId}
    />
  );
}
