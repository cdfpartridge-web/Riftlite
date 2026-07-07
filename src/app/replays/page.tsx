import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { createPageMetadata } from "@/lib/seo";
import { formatDate } from "@/lib/utils";
import { listRiftLiteReplays } from "@/lib/riftreplay/replay-list";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "RiftLite Replays",
  description: "Browse public RiftLite raw Atlas replays uploaded from the desktop app.",
  path: "/replays",
});

export default async function ReplaysPage() {
  const replays = await listRiftLiteReplays({ limit: 120 });

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-10">
      <section className="overflow-hidden rounded-[32px] border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_38%),linear-gradient(135deg,rgba(12,17,40,0.96),rgba(27,21,55,0.96))] p-8 shadow-[0_18px_70px_rgba(4,8,23,0.52)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge>Replay hub</Badge>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              RiftLite replay library
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-300">
              Public Atlas raw replays uploaded from RiftLite. Pick a match to open the animated board viewer.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-sm text-slate-300">
            <span className="block text-3xl font-semibold text-white">{replays.length}</span>
            public replay{replays.length === 1 ? "" : "s"} visible
          </div>
        </div>
      </section>

      {replays.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {replays.map((replay) => (
            <Card key={replay.replayId} className="flex min-h-[230px] flex-col gap-5 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <CardTitle className="line-clamp-2 text-lg">{replay.title}</CardTitle>
                  <CardDescription>
                    {formatDate(replay.createdAt)} · {replay.platform || "Atlas"}
                  </CardDescription>
                </div>
                <Badge className="shrink-0 tracking-[0.12em]">{replay.visibility}</Badge>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Room</dt>
                  <dd className="mt-1 truncate font-semibold text-slate-100">{replay.roomCode || "Unknown"}</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">Frames</dt>
                  <dd className="mt-1 font-semibold text-slate-100">{replay.messageCount.toLocaleString("en-GB")}</dd>
                </div>
              </dl>

              <div className="mt-auto flex items-center justify-between gap-3">
                <span className="truncate text-xs text-slate-500">{replay.replayId}</span>
                <Button asChild size="sm">
                  <Link href={replay.path}>Open replay</Link>
                </Button>
              </div>
            </Card>
          ))}
        </section>
      ) : (
        <Card className="rounded-2xl p-8 text-center">
          <CardTitle>No public replays yet</CardTitle>
          <CardDescription className="mx-auto mt-3 max-w-2xl">
            Enable RiftReplay raw capture in RiftLite, choose public visibility, then finish an Atlas match. Uploaded
            matches will appear here without needing a client update.
          </CardDescription>
        </Card>
      )}
    </main>
  );
}
