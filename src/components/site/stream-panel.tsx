import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { StreamEmbed } from "@/components/site/stream-embed";
import type { StreamModule, StreamStatus } from "@/lib/types";

type StreamPanelProps = {
  module: StreamModule;
  status: StreamStatus;
};

export function StreamPanel({ module, status }: StreamPanelProps) {
  const isLive = status.state === "live";
  const stateLabel =
    status.state === "live"
      ? "Live now"
      : status.state === "offline"
        ? "Offline"
        : "Status unavailable";

  return (
    <Card className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="flex flex-col justify-between gap-6">
        <div className="space-y-5">
          {/* Live / offline badge */}
          <div className="flex items-center gap-2.5">
            {isLive ? (
              <span className="live-dot" />
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-slate-600" />
            )}
            <span
              className={`text-xs font-semibold uppercase tracking-[0.2em] ${isLive ? "text-emerald-300" : "text-slate-500"}`}
            >
              {stateLabel}
            </span>
          </div>

          <div className="space-y-2">
            <CardTitle className="text-2xl">{module.title}</CardTitle>
            <CardDescription>{module.subtitle}</CardDescription>
            {status.tooltip && (
              <p className="text-sm text-slate-500">{status.tooltip}</p>
            )}
          </div>
        </div>

        <Button asChild variant="secondary">
          <Link href={module.channelUrl}>Open on Twitch</Link>
        </Button>
      </div>

      <StreamEmbed channelLogin={module.channelLogin} />
    </Card>
  );
}
