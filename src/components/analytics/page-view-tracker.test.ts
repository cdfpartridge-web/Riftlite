import { describe, expect, it } from "vitest";

import { sanitizeAnalyticsReferrer } from "@/components/analytics/page-view-tracker";

describe("page-view analytics referrer privacy", () => {
  it("retains only origin and pathname", () => {
    expect(sanitizeAnalyticsReferrer(
      "https://www.riftlite.com/link-device?session=secret&code=ABC123#fragment",
    )).toBe("https://www.riftlite.com/link-device");
  });

  it("rejects malformed and non-web referrers", () => {
    expect(sanitizeAnalyticsReferrer("not a URL")).toBe("");
    expect(sanitizeAnalyticsReferrer("data:text/plain,secret")).toBe("");
  });
});
