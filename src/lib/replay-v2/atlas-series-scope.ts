import { integerValue, isRecord, stringValue } from "@/lib/replay-v2/json";
import { stableId } from "@/lib/replay-v2/stable-id";
import type { ParsedReplayPacket, ReplayDiagnostic } from "@/lib/replay-v2/types";

/** Atlas can retain a previous-room snapshot while returning to a fresh series lobby. */
export function scopeAtlasSeriesPackets(
  packets: ParsedReplayPacket[],
  seriesId: string,
  diagnostics: ReplayDiagnostic[],
): { packets: ParsedReplayPacket[]; roomCode?: string } {
  if (!seriesId) return { packets };
  const anchorIndex = packets.findIndex(packet => {
    const doc = sessionDoc(packet);
    return packet.direction === "in" && packet.packetType === "room_shell_sync" &&
      stringValue(doc?.seriesId) === seriesId && integerValue(doc?.gameNumber) === 1 &&
      stringValue(doc?.phase) === "lobby" && Boolean(stringValue(doc?.previousRoomCode));
  });
  if (anchorIndex < 1) return { packets };
  const anchor = packets[anchorIndex];
  const doc = sessionDoc(anchor)!;
  const roomCode = stringValue(doc.roomCode);
  const previousRoom = stringValue(doc.previousRoomCode);
  if (!roomCode || roomCode === previousRoom || packetRoom(anchor) !== roomCode) return { packets };

  const prefix = packets.slice(0, anchorIndex);
  // A room reference alone is not permission to drop a genuine earlier game.
  // Require an old gameplay snapshot, the captured series' explicit Game 1 lobby,
  // and no contradictory series/room evidence anywhere in the retained capture.
  if (!prefix.some(packet => packet.packetType === "authoritative_snapshot" &&
    packet.direction === "in" && packetRoom(packet) === previousRoom &&
    isRecord(packet.payload?.snapshot) && packet.payload.snapshot.phase === "in_game")) return { packets };
  if (prefix.some(packet => {
    const room = packetRoom(packet);
    return (room && room !== previousRoom && room !== roomCode) ||
      (room !== roomCode && stringValue(sessionDoc(packet)?.seriesId) === seriesId);
  })) return { packets };
  if (packets.slice(anchorIndex).some(packet =>
    packet.packetType === "room_shell_sync" && packetRoom(packet) === previousRoom)) return { packets };

  const firstCurrentRoom = prefix.findIndex(packet => packetRoom(packet) === roomCode);
  const start = firstCurrentRoom < 0 ? anchorIndex : firstCurrentRoom;
  const scoped = packets.slice(start).filter(packet => packetRoom(packet) !== previousRoom);
  diagnostics.push({
    id: stableId("diagnostic", anchor.id, "previous_series_preamble_excluded"),
    severity: "warning",
    code: "previous_series_preamble_excluded",
    message: `Excluded ${packets.length - scoped.length} previous-room preamble packets using the captured series' explicit Game 1 lobby. The original raw capture is retained.`,
    sourceMessageId: anchor.id,
  });
  return { packets: scoped, roomCode };
}

function sessionDoc(packet: ParsedReplayPacket) {
  return isRecord(packet.payload?.sessionDoc) ? packet.payload.sessionDoc : null;
}

function packetRoom(packet: ParsedReplayPacket): string {
  const snapshot = isRecord(packet.payload?.snapshot) ? packet.payload.snapshot : null;
  return stringValue(packet.payload?.gameInstanceId) || stringValue(sessionDoc(packet)?.roomCode) ||
    stringValue(snapshot?.roomCode) || stringValue(packet.payload?.roomCode);
}
