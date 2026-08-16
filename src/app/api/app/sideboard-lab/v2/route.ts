import { NextRequest, NextResponse } from "next/server";

import { mulliganCardIdentity, mulliganCardMetadata } from "@/lib/mulligan-lab/registry";
import { readSideboardLabPack } from "@/lib/sideboard-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};
const SHA256 = /^[a-f0-9]{64}$/;

export async function GET(request: NextRequest) {
  const playerLegend = canonicalIdentity(request.nextUrl.searchParams.get("playerLegend"));
  const opponentRaw = request.nextUrl.searchParams.get("opponentLegend");
  const opponentLegend = opponentRaw ? canonicalIdentity(opponentRaw) : undefined;
  const deckFingerprint = optionalSha256(request.nextUrl.searchParams.get("deckFingerprint"));
  const resultRaw = request.nextUrl.searchParams.get("priorGameResult");
  const priorGameResult = resultRaw === "win" || resultRaw === "loss" ? resultRaw : undefined;
  const gameRaw = request.nextUrl.searchParams.get("targetGameNumber");
  const targetGameNumber = gameRaw === null || gameRaw === "2" ? 2 : gameRaw === "3" ? 3 : undefined;
  const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
  if (
    !playerLegend ||
    (opponentRaw && !opponentLegend) ||
    (request.nextUrl.searchParams.has("deckFingerprint") && !deckFingerprint) ||
    (resultRaw && !priorGameResult) ||
    targetGameNumber === undefined ||
    (request.nextUrl.searchParams.has("limit") && limit === undefined)
  ) {
    return NextResponse.json({ error: "invalid_lab_query" }, { status: 400, headers: HEADERS });
  }
  return NextResponse.json(await readSideboardLabPack({
    playerLegendIdentityCode: playerLegend,
    ...(opponentLegend ? { opponentLegendIdentityCode: opponentLegend } : {}),
    ...(deckFingerprint ? { deckFingerprint } : {}),
    ...(priorGameResult ? { priorGameResult } : {}),
    targetGameNumber,
    ...(limit ? { limit } : {}),
  }), { headers: HEADERS });
}

function canonicalIdentity(value: string | null): string | undefined {
  const normalized = value?.trim().toUpperCase() ?? "";
  const metadata = normalized ? mulliganCardMetadata(normalized) : null;
  return metadata?.type.toLowerCase() === "legend"
    ? mulliganCardIdentity(normalized) ?? undefined
    : undefined;
}

function optionalSha256(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized && SHA256.test(normalized) ? normalized : undefined;
}

function boundedLimit(value: string | null): number | undefined {
  if (value === null) return 12;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 ? parsed : undefined;
}
