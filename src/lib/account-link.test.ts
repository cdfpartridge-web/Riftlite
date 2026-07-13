import { describe, expect, it } from "vitest";

import {
  accountIdHint,
  accountIdentityLabel,
  desktopLinkAllowsIdentity,
  desktopLinkCanReissueToken,
  shouldAutomaticallyFinishAccountAction,
} from "@/lib/account-link";
import {
  historicalDesktopIdentitySources,
} from "@/lib/account-connection";

describe("desktop account linking", () => {
  it("never auto-finishes a desktop link for an existing browser session", () => {
    expect(shouldAutomaticallyFinishAccountAction(true, true, "website-user", "")).toBe(false);
    expect(shouldAutomaticallyFinishAccountAction(true, true, "website-user", "another-user")).toBe(false);
  });

  it("retains automatic completion for non-desktop account actions", () => {
    expect(shouldAutomaticallyFinishAccountAction(false, true, "website-user", "")).toBe(true);
    expect(shouldAutomaticallyFinishAccountAction(false, false, "website-user", "")).toBe(false);
    expect(shouldAutomaticallyFinishAccountAction(false, true, "website-user", "website-user")).toBe(false);
  });

  it("builds a clear confirmation identity without exposing a full UID", () => {
    expect(accountIdentityLabel({
      uid: "firebase-account-123456",
      email: "person@example.com",
      displayName: "BMU",
      handle: "BMU",
    })).toBe("BMU (@BMU)");
    expect(accountIdHint("firebase-account-123456")).toBe("fireba...3456");
  });

  it("allows a new device to choose an account but pins reconnects to the existing UID", () => {
    expect(desktopLinkAllowsIdentity("", "account-1")).toBe(true);
    expect(desktopLinkAllowsIdentity("account-1", "account-1")).toBe(true);
    expect(desktopLinkAllowsIdentity("account-1", "account-2")).toBe(false);
  });

  it("allows the same authenticated device to recover a consumed token only inside its link window", () => {
    expect(desktopLinkCanReissueToken("complete", "account-1", 20_000, 10_000)).toBe(true);
    expect(desktopLinkCanReissueToken("complete", "account-1", 9_999, 10_000)).toBe(false);
    expect(desktopLinkCanReissueToken("pending", "account-1", 20_000, 10_000)).toBe(false);
    expect(desktopLinkCanReissueToken("complete", "", 20_000, 10_000)).toBe(false);
  });

  it("recovers every historical desktop identity that completed a link to the same account", () => {
    expect(historicalDesktopIdentitySources([
      { status: "complete", desktopUid: "old-pc", linkedUid: "account-1" },
      { status: "complete", desktopUid: "old-laptop", linkedUid: "account-1" },
      { status: "complete", desktopUid: "old-pc", linkedUid: "account-1" },
      { status: "pending", desktopUid: "unfinished", linkedUid: "account-1" },
      { status: "complete", desktopUid: "other-device", linkedUid: "account-2" },
      { status: "complete", desktopUid: "account-1", linkedUid: "account-1" },
    ], "account-1")).toEqual(["old-pc", "old-laptop"]);
  });
});
