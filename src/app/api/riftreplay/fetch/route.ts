import { gunzipSync } from "node:zlib";

import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RequestSchema = z.object({
  replayId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9_-]+$/),
  apiKey: z.string().trim().min(6).max(512),
  endpoint: z.string().trim().url().optional(),
});

const ALLOWED_HOSTS = new Set(["test.riftreplay.com", "riftreplay.com"]);

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Replay ID, endpoint, or API key is invalid." }, { status: 400 });
  }

  const { replayId, apiKey } = parsed.data;
  const endpoint = normalizeEndpoint(parsed.data.endpoint ?? "https://riftreplay.com");
  if (!endpoint) {
    return NextResponse.json({ error: "Only test.riftreplay.com and riftreplay.com are supported." }, { status: 400 });
  }

  const candidates = [
    `${endpoint}/api/v1/replays/${encodeURIComponent(replayId)}/raw`,
    `${endpoint}/api/v1/replays/${encodeURIComponent(replayId)}/blob`,
    `${endpoint}/api/v1/replays/${encodeURIComponent(replayId)}`,
  ];

  let lastStatus = 0;
  let lastMessage = "Replay was not found.";

  for (const url of candidates) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, application/gzip, application/octet-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });
    lastStatus = response.status;
    if (!response.ok) {
      lastMessage = await safeErrorMessage(response);
      if (response.status === 401 || response.status === 403) {
        break;
      }
      continue;
    }

    const payload = await decodeReplayResponse(response);
    return NextResponse.json(
      { payload },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(
    { error: lastStatus === 401 || lastStatus === 403 ? "RiftReplay rejected that API key." : lastMessage },
    { status: lastStatus || 404 },
  );
}

function normalizeEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (!ALLOWED_HOSTS.has(url.hostname)) return "";
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return "";
  }
}

async function decodeReplayResponse(response: Response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = decodeBuffer(buffer, response.headers.get("content-encoding") ?? "", response.headers.get("content-type") ?? "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("RiftReplay returned an empty replay payload.");
    }
    return { schema: "riftreplay-raw-text", version: 1, text: trimmed };
  }
}

function decodeBuffer(buffer: Buffer, encoding: string, contentType: string) {
  const looksGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (looksGzip || encoding.toLowerCase().includes("gzip") || contentType.toLowerCase().includes("gzip")) {
    return gunzipSync(buffer).toString("utf8");
  }
  return buffer.toString("utf8");
}

async function safeErrorMessage(response: Response) {
  try {
    const text = await response.text();
    if (!text.trim()) return `RiftReplay returned ${response.status}.`;
    return text.slice(0, 240);
  } catch {
    return `RiftReplay returned ${response.status}.`;
  }
}
