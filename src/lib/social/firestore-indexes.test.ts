import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type FieldOverride = {
  collectionGroup?: string;
  fieldPath?: string;
  indexes?: Array<{ order?: string; queryScope?: string }>;
};

describe("Firestore social collection-group indexes", () => {
  it("keeps every indexed social lookup out of whole-collection fallback paths", () => {
    const firebase = JSON.parse(readFileSync(join(process.cwd(), "firebase.json"), "utf8")) as {
      firestore?: { indexes?: string };
    };
    const config = JSON.parse(readFileSync(join(process.cwd(), "firestore.indexes.json"), "utf8")) as {
      fieldOverrides?: FieldOverride[];
    };
    const socialServer = readFileSync(join(process.cwd(), "src/lib/social/server.ts"), "utf8");

    expect(firebase.firestore?.indexes).toBe("firestore.indexes.json");
    expect(socialServer).not.toContain("db.collection(parentCollection).get()");
    for (const [collectionGroup, fieldPath] of [
      ["members", "uid"],
      ["matches", "uid"],
      ["messages", "uid"],
      ["inbox", "senderUid"],
    ]) {
      const override = config.fieldOverrides?.find((candidate) => (
        candidate.collectionGroup === collectionGroup && candidate.fieldPath === fieldPath
      ));
      expect(override, `${collectionGroup}.${fieldPath}`).toBeDefined();
      expect(override?.indexes).toEqual(expect.arrayContaining([
        { order: "ASCENDING", queryScope: "COLLECTION_GROUP" },
        { order: "DESCENDING", queryScope: "COLLECTION_GROUP" },
      ]));
    }
  });
});
