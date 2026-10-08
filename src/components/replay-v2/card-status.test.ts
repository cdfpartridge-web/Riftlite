import { describe, expect, it } from "vitest";

import type { JsonObject, ReplayCardState } from "@/lib/replay-v2";
import { normalizeRawCaptureV1 } from "@/lib/replay-v2/normalize-replay";
import { syntheticBo3Capture } from "@/lib/replay-v2/__fixtures__/synthetic-captures";
import { projectReplayState } from "@/lib/replay-v2/project-state";
import { seekReplayByEventIndex } from "@/lib/replay-v2/seek";
import { cardStatuses, cardStatusText } from "./card-status";

const card = (fields: JsonObject): ReplayCardState => ({ id: "unit", name: "Unit", fields });
const texts = (value: ReplayCardState) => cardStatuses(value).map(cardStatusText);

describe("recorded Atlas card indicators", () => {
  it("recognizes all current preset labels and counted defaults", () => {
    expect(texts(card({ customLabels: ["Buff", "Disarm", "Deflect", "Deathknell", "Shield", "Stunned", "Tank", "Empowered", "Ganking", "Assault", "Temporary"] })))
      .toEqual(["Buff 1", "Disarm 1", "Deflect 1", "Deathknell", "Shield 1", "Stunned", "Tank", "Empowered 1", "Ganking", "Assault 1", "Temporary"]);
  });

  it("combines the numeric buff with label slots and preserves custom text", () => {
    expect(texts(card({ temporaryMightBuff: 3, customLabels: [" stunned ", " SHIELD   4", "Temporary", "My reminder", "", 42] })))
      .toEqual(["Buff 3", "Stunned", "Shield 4", "Temporary", "My reminder"]);
  });

  it.each(["buff", "shield", "assault", "disarm", "empowered", "deflect"])("matches Atlas's 1–99 counted %s labels", kind => {
    expect(cardStatuses(card({ customLabels: [`${kind} 0`, `${kind} 007`, `${kind} 1000`] })).map(s => s.count))
      .toEqual([1, 7, 99]);
  });

  it.each([0, -1, 0.5, "3", true, null, [], {}])("does not invent a buff from malformed/inactive value %j", value => {
    expect(cardStatuses(card({ temporaryMightBuff: value }))).toEqual([]);
  });

  it("does not infer active states from printed keywords, might or legacy counters", () => {
    expect(cardStatuses(card({ keywords: ["Temporary", "Stun", "Buff"], text: "Buff a unit", might: 6, whiteCounter: 3, redCounter: 1 })))
      .toEqual([]);
    expect(texts(card({ customLabels: ["Stunned 2", "Buff -3", "Shield 1.5", "New status"] })))
      .toEqual(["Stunned 2", "Buff -3", "Shield 1.5", "New status"]);
  });

  it("does not reveal a placeholder's indicators", () => {
    expect(cardStatuses({ ...card({ temporaryMightBuff: 2, customLabels: ["Stunned", "Secret"] }), isPlaceholder: true })).toEqual([]);
  });

  it("round-trips snapshots, confirmed changes and removals through forward/backward checkpoint seeking", () => {
    const capture = syntheticBo3Capture();
    capture.messages = capture.messages.slice(0, 5);
    const snapshot = JSON.parse(capture.messages[2].raw!);
    Object.assign(snapshot.snapshot.players[1].board.hand[0], {
      customLabels: ["Stunned", "PRIVATE LABEL"], temporaryMightBuff: 9,
    });
    capture.messages[2].raw = JSON.stringify(snapshot);
    // The last fixture message moves a visible card to base; attach real Atlas fields.
    const move = JSON.parse(capture.messages[4].raw!);
    move.patch.operations[0].card.temporaryMightBuff = 2;
    move.patch.operations[0].card.customLabels = ["Stunned", "Shield 3"];
    capture.messages[4].raw = JSON.stringify(move);
    for (const [i, operation] of [
      { op: "patch_card_fields", fields: { temporaryMightBuff: 4, customLabels: ["Temporary", "Assault 2"] } },
      { op: "unset_card_fields", fields: ["temporaryMightBuff", "customLabels"] },
    ].entries()) {
      capture.messages.push({ seq: 5 + i, ts: 1_033_000 + i * 1_000, dir: "in", raw: JSON.stringify({
        type: "authoritative_patch_commit", gameInstanceId: "ROOM42", baseSequence: 2 + i, sequence: 3 + i,
        patch: { operations: [{ ...operation, playerId: "player-local", zone: "base", cardId: "local-card" }] },
      }) });
    }
    const replay = normalizeRawCaptureV1(capture, { checkpoints: { everyEvents: 1 } });
    expect(JSON.stringify(replay)).not.toContain("PRIVATE LABEL");
    const readAt = (index: number) => seekReplayByEventIndex(replay, index).state.players["player-local"].zones.base.find(c => c.id === "local-card")!;
    const initialIndex = replay.events.findIndex(event => event.kind === "action" && event.patch.operations.some(op => op.op === "zone_move"));
    const changedIndex = replay.events.findIndex(event => event.kind === "action" && event.patch.operations.some(op => op.op === "patch_card_fields"));
    const removedIndex = replay.events.findIndex(event => event.kind === "action" && event.patch.operations.some(op => op.op === "unset_card_fields"));
    expect(initialIndex).toBeGreaterThanOrEqual(0);
    expect(texts(readAt(initialIndex))).toEqual(["Buff 2", "Stunned", "Shield 3"]);
    expect(texts(readAt(changedIndex))).toEqual(["Buff 4", "Temporary", "Assault 2"]);
    expect(texts(readAt(removedIndex))).toEqual([]);
    expect(texts(readAt(initialIndex))).toEqual(["Buff 2", "Stunned", "Shield 3"]);
    expect(seekReplayByEventIndex(replay, changedIndex).state).toEqual(projectReplayState(replay, changedIndex));
    const opponentHand = seekReplayByEventIndex(replay, initialIndex).state.players["player-opponent"].zones.hand;
    expect(opponentHand.every(c => c.isPlaceholder && cardStatuses(c).length === 0)).toBe(true);
  });
});
