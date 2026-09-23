import { NextResponse } from "next/server";
import {
  OpeningLabError,
  openingCatalog,
  revealOpening,
  startOpening,
} from "@/lib/opening-lab/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function failure(error: unknown) {
  return respond(
    {
      error:
        error instanceof OpeningLabError
          ? error.message
          : "Opening practice is temporarily unavailable. Please try again.",
    },
    error instanceof OpeningLabError ? error.status : 503,
  );
}
export async function GET() {
  try {
    return respond(await openingCatalog());
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const requestUrl = new URL(request.url);
    const expectedOrigin = request.headers.get("host")
      ? `${requestUrl.protocol}//${request.headers.get("host")}`
      : requestUrl.origin;
    if (origin && origin !== expectedOrigin)
      throw new OpeningLabError("Open practice on RiftLite.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new OpeningLabError("Send a practice selection.", 415);
    const reader = request.body?.getReader();
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw new OpeningLabError("The selection is too large.", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    text += decoder.decode();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw new OpeningLabError("Choose a practice action.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new OpeningLabError("Choose a practice action.");
    if (
      body.action === "start" &&
      typeof body.legend === "string" &&
      (body.opponent === undefined || typeof body.opponent === "string")
    )
      return respond(
        await startOpening({
          legend: body.legend,
          opponent: body.opponent as string | undefined,
        }),
      );
    if (
      body.action === "reveal" &&
      body.locked === true &&
      typeof body.token === "string"
    )
      return respond(await revealOpening(body.token));
    throw new OpeningLabError(
      "Choose a legend or lock your position before revealing.",
    );
  } catch (error) {
    return failure(error);
  }
}
