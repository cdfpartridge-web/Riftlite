import { describe, expect, it } from "vitest";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { parseRawCaptureV1 } from "@/lib/replay-v2/parse-raw-capture";
import { assessReplayPublicationQuality } from "@/lib/replay-v2/replay-quality";
import type { JsonObject, RawCaptureV1 } from "@/lib/replay-v2/types";

function captureWithPreviousRoom(lobbyFields: JsonObject = {}): RawCaptureV1 {
  const capture = syntheticBo3Capture();
  capture.capture!.identity = { ...capture.capture!.identity, roomCode: "PREVIOUS", seriesId: "new-series" };
  capture.messages = [
    { ts: 999_000, dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", gameInstanceId: "PREVIOUS", sequence: 456,
      snapshot: { roomCode: "PREVIOUS", phase: "in_game", players: [
        { id: "previous-opponent", name: "Previous opponent", board: { score: 6 } },
      ] },
    }) },
    { ts: 999_100, dir: "out", raw: JSON.stringify({ type: "join_shell", gameInstanceId: "ROOM42" }) },
    { ts: 999_200, dir: "in", raw: JSON.stringify({
      type: "room_shell_sync", gameInstanceId: "ROOM42", sessionDoc: {
        roomCode: "ROOM42", previousRoomCode: "PREVIOUS", seriesId: "new-series",
        gameNumber: 1, phase: "lobby", matchFormat: "bo3", ...lobbyFields,
      },
    }) },
    { ts: 999_300, dir: "in", raw: JSON.stringify({
      type: "room_shell_sync", gameInstanceId: "ROOM42", sessionDoc: {
        roomCode: "ROOM42", seriesId: "new-series", gameNumber: 1, phase: "battlefield_pick",
      },
    }) },
    { ts: 999_400, dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", gameInstanceId: "ROOM42", sequence: 0,
      snapshot: { roomCode: "ROOM42", phase: "battlefield_pick", players: [] },
    }) },
    ...capture.messages,
  ].map((message, seq) => ({ ...message, seq }));
  return capture;
}

describe("Atlas previous-room capture preamble", () => {
  it("keeps the identified new series, its opening and equal-result games without carrying the old opponent", () => {
    const capture = captureWithPreviousRoom();
    const before = JSON.stringify(capture);
    const parsed = parseRawCaptureV1(capture);
    const replay = normalizeRawCaptureV1(capture);

    expect(replay.series.games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    expect(replay.series.games.map(game => game.result?.winnerPlayerId)).toEqual([
      "player-local", "player-local", "player-opponent",
    ]);
    expect(replay.series.roomCode).toBe("ROOM42");
    expect(replay.series.participants.some(player => player.id === "previous-opponent")).toBe(false);
    expect(JSON.stringify(replay)).not.toContain("Previous opponent");
    expect(parsed.source.messages).toHaveLength(capture.messages.length);
    expect(parsed.packets[0].sourceIndex).toBe(1);
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: "previous_series_preamble_excluded" }));
    expect(JSON.stringify(capture)).toBe(before);
    expect(assessReplayPublicationQuality(replay).issues.map(issue => issue.code)).not.toContain("duplicate_game_number");
  });

  it.each([
    ["missing series", { seriesId: "" }],
    ["conflicting series", { seriesId: "another-series" }],
    ["later game", { gameNumber: 2 }],
    ["missing lobby reset", { phase: "battlefield_pick" }],
    ["missing predecessor", { previousRoomCode: "" }],
    ["unrelated predecessor", { previousRoomCode: "SOMETHING-ELSE" }],
  ] as Array<[string, JsonObject]>)("does not discard state with %s", (_name, fields) => {
    const capture = captureWithPreviousRoom(fields);
    const parsed = parseRawCaptureV1(capture);
    expect(parsed.packets).toHaveLength(capture.messages.length);
    expect(parsed.diagnostics.some(entry => entry.code === "previous_series_preamble_excluded")).toBe(false);
  });

  it("preserves a previous room explicitly identified as part of this same series", () => {
    const capture = captureWithPreviousRoom();
    capture.messages.unshift({ ts: 998_000, dir: "in", raw: JSON.stringify({
      type: "room_shell_sync", gameInstanceId: "PREVIOUS",
      sessionDoc: { roomCode: "PREVIOUS", seriesId: "new-series", gameNumber: 1, phase: "in_game" },
    }) });
    capture.messages.forEach((message, seq) => { message.seq = seq; });
    const parsed = parseRawCaptureV1(capture);
    expect(parsed.packets).toHaveLength(capture.messages.length);
    expect(parsed.diagnostics.some(entry => entry.code === "previous_series_preamble_excluded")).toBe(false);
  });

  it("preserves an ambiguous preamble involving another room", () => {
    const capture = captureWithPreviousRoom();
    capture.messages.unshift({ ts: 998_000, dir: "in", raw: JSON.stringify({
      type: "authoritative_snapshot", gameInstanceId: "THIRD-ROOM",
      snapshot: { phase: "in_game", players: [] },
    }) });
    capture.messages.forEach((message, seq) => { message.seq = seq; });
    expect(parseRawCaptureV1(capture).packets).toHaveLength(capture.messages.length);
  });

  it("preserves the previous room if a later numbered game explicitly returns there", () => {
    const capture = captureWithPreviousRoom();
    capture.messages.push({ seq: capture.messages.length, ts: 1_100_000, dir: "in", raw: JSON.stringify({
      type: "room_shell_sync", gameInstanceId: "PREVIOUS",
      sessionDoc: { roomCode: "PREVIOUS", seriesId: "new-series", gameNumber: 3, phase: "sideboarding" },
    }) });
    expect(parseRawCaptureV1(capture).packets).toHaveLength(capture.messages.length);
  });

  it("does not apply repair without the capture's own series identity", () => {
    const capture = captureWithPreviousRoom();
    delete capture.capture!.identity!.seriesId;
    expect(parseRawCaptureV1(capture).packets).toHaveLength(capture.messages.length);
  });

  it("does not reinterpret a normal numbered BO3 or waive genuinely duplicate game numbers", () => {
    const capture = syntheticBo3Capture();
    const normal = normalizeRawCaptureV1(capture);
    expect(normal.series.games.map(game => game.gameNumber)).toEqual([1, 2, 3]);
    normal.series.games[1].gameNumber = 1;
    expect(assessReplayPublicationQuality(normal).issues.map(issue => issue.code)).toContain("duplicate_game_number");
  });
});
