import { NextResponse } from "next/server";

import {
  localTcgaReplayPreviewEnabled,
  readLocalTcgaCanonicalReplay,
} from "@/lib/local-tcga-replay-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ fixtureId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const directory = process.env.RIFTLITE_LOCAL_TCGA_REPLAY_DIR?.trim() ?? "";
  if (!localTcgaReplayPreviewEnabled() || !directory) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const { fixtureId } = await context.params;
    const bytes = await readLocalTcgaCanonicalReplay(fixtureId, directory);
    return new Response(Uint8Array.from(bytes).buffer, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
