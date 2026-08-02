import { describe, expect, it } from "vitest";

import { metaStudioUidAllowed } from "@/lib/community/meta-studio-auth";

describe("Meta Studio UID allowlist", () => {
  it("allows only an exact canonical UID match", () => {
    expect(metaStudioUidAllowed("canonical-bmu", "canonical-bmu")).toBe(true);
    expect(metaStudioUidAllowed("canonical-bmu", " other, canonical-bmu ,third ")).toBe(true);
    expect(metaStudioUidAllowed("CANONICAL-BMU", "canonical-bmu")).toBe(false);
    expect(metaStudioUidAllowed("bmu", "canonical-bmu")).toBe(false);
  });

  it("fails closed when no UID is configured", () => {
    expect(metaStudioUidAllowed("canonical-bmu", "")).toBe(false);
    expect(metaStudioUidAllowed("", "canonical-bmu")).toBe(false);
  });
});
