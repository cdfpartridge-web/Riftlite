import { getStreamStatus } from "@/lib/twitch/status";

export async function GET() {
  return Response.json(await getStreamStatus());
}
