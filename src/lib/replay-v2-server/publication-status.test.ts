import { describe, expect, it } from "vitest";

import {
  replayPublicationFailureCode,
  replayPublicationWarnings,
} from "@/lib/replay-v2-server/publication-status";

describe("replay publication recovery contract", () => {
  const missingMulligan = {
    code: "missing_mulligan" as const,
    message: "The replay did not capture the opening mulligan.",
  };

  it("uses a stable missing-mulligan error code without changing its message", () => {
    expect(replayPublicationFailureCode([missingMulligan])).toBe("replay_capture_missing_mulligan");
    expect(replayPublicationWarnings([missingMulligan])).toEqual([{
      code: "replay_capture_missing_mulligan",
      message: "The replay did not capture the opening mulligan.",
    }]);
  });

  it("keeps mixed unsafe capture failures on the general incomplete code", () => {
    expect(replayPublicationFailureCode([
      missingMulligan,
      { code: "missing_gameplay", message: "The replay ended before gameplay was captured." },
    ])).toBe("replay_capture_incomplete");
  });
});
