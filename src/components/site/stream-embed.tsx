"use client";

import { useSyncExternalStore } from "react";

type StreamEmbedProps = {
  channelLogin: string;
};

export function StreamEmbed({ channelLogin }: StreamEmbedProps) {
  const host = useSyncExternalStore(
    () => () => {},
    () => window.location.hostname || "localhost",
    () => "localhost",
  );

  const src = `https://player.twitch.tv/?channel=${channelLogin}&parent=${host}&muted=true`;

  return (
    <iframe
      allowFullScreen
      className="aspect-video w-full rounded-[20px] border border-white/10 bg-slate-950/40"
      src={src}
      title="BMU Casts Twitch stream"
    />
  );
}
