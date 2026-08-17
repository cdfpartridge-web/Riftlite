import { cookies } from "next/headers";

import { CasterStudioLibrary } from "@/components/replay-v2/caster";
import {
  META_STUDIO_SESSION_COOKIE,
  verifyMetaStudioSession,
} from "@/lib/community/meta-studio-auth";
import { createNoIndexMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = createNoIndexMetadata(
  "Private Replay Research",
  "Search private and unlisted RiftLite web replays for private Meta Studio research.",
  "/meta-studio/caster",
);

export default async function CasterStudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const preview = process.env.NODE_ENV === "development" && String(params.preview ?? "") === "1";
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(META_STUDIO_SESSION_COOKIE)?.value ?? "";
  const principal = preview ? null : await verifyMetaStudioSession(sessionCookie);

  return (
    <CasterStudioLibrary
      initialAuthorized={Boolean(principal)}
      preview={preview}
    />
  );
}
