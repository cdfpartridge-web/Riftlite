export type AccountMigrationState = "ready" | "pending" | "attention";

export type AccountMigrationRecord = {
  migrationCompletedAt?: unknown;
  migrationError?: unknown;
  cloudSyncConflict?: unknown;
};

export const DESKTOP_IDENTITY_BACKFILL_VERSION = 1;

export type DesktopLinkHistoryRecord = {
  status?: unknown;
  desktopUid?: unknown;
  linkedUid?: unknown;
};

export function historicalDesktopIdentitySources(
  records: DesktopLinkHistoryRecord[],
  canonicalUid: string,
): string[] {
  const canonical = canonicalUid.trim();
  if (!canonical) return [];
  return Array.from(new Set(records.flatMap((record) => {
    const source = String(record.desktopUid ?? "").trim();
    const linked = String(record.linkedUid ?? "").trim();
    return record.status === "complete" && linked === canonical && source && source !== canonical
      ? [source]
      : [];
  })));
}

export function summarizeAccountMigration(records: AccountMigrationRecord[]): {
  state: AccountMigrationState;
  message: string;
} {
  let state: AccountMigrationState = "ready";
  const messages: string[] = [];
  for (const record of records) {
    if (record.migrationError || record.cloudSyncConflict === true) {
      state = "attention";
      if (record.migrationError) messages.push("Some older account records still need repair.");
      if (record.cloudSyncConflict === true) messages.push("Two device backups were retained for safe recovery.");
    } else if (!record.migrationCompletedAt) {
      if (state !== "attention") state = "pending";
      messages.push("Older account records are still being linked.");
    }
  }
  return { state, message: Array.from(new Set(messages)).join(" ") };
}

export function accountConnectionUidMatches(expectedUid: string, observedUid: string): boolean {
  return Boolean(expectedUid.trim() && expectedUid.trim() === observedUid.trim());
}
