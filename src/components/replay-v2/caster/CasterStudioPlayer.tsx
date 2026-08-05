"use client";

import { ReplayV2Player } from "@/components/replay-v2";

import { CasterStudioAccess } from "./CasterStudioAccess";

export function CasterStudioPlayer({
  initialAuthorized,
  preview = false,
  replayId,
}: {
  initialAuthorized: boolean;
  preview?: boolean;
  replayId: string;
}) {
  if (!initialAuthorized && !preview) return <CasterStudioAccess />;

  return (
    <ReplayV2Player
      apiBasePath={preview ? "/api/v2/replays" : "/api/meta-studio/caster/replays"}
      casterLibraryHref={preview ? "/meta-studio/caster?preview=1" : "/meta-studio/caster"}
      mode="caster"
      replayId={replayId}
    />
  );
}
