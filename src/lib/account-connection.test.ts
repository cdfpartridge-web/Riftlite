import { describe, expect, it } from "vitest";

import { accountConnectionUidMatches, summarizeAccountMigration } from "@/lib/account-connection";

describe("account connection health", () => {
  it("requires the exact same UID", () => {
    expect(accountConnectionUidMatches("account-1", "account-1")).toBe(true);
    expect(accountConnectionUidMatches("account-1", "account-2")).toBe(false);
    expect(accountConnectionUidMatches("", "account-1")).toBe(false);
  });

  it("distinguishes ready, pending, and attention migration states", () => {
    expect(summarizeAccountMigration([{ migrationCompletedAt: 123 }])).toEqual({ state: "ready", message: "" });
    expect(summarizeAccountMigration([{}])).toEqual({
      state: "pending",
      message: "Older account records are still being linked.",
    });
    expect(summarizeAccountMigration([{ migrationError: "retry" }, { cloudSyncConflict: true }])).toEqual({
      state: "attention",
      message: "Some older account records still need repair. Two device backups were retained for safe recovery.",
    });
  });
});
