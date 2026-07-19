import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RETIRED_BOOTSTRAP_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

export function GET() {
  return retiredBootstrapResponse();
}

export function POST() {
  return retiredBootstrapResponse();
}

function retiredBootstrapResponse() {
  return NextResponse.json({
    error: "Desktop bootstrap authentication is retired. Sign in with Google or email to link this device.",
  }, {
    status: 410,
    headers: RETIRED_BOOTSTRAP_HEADERS,
  });
}
