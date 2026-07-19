import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

describe("versioned Firestore security rules", () => {
  it("keeps hub membership and role documents server-authoritative", () => {
    expect(rules).toMatch(/match \/members\/\{uid\}[\s\S]*?allow read, write: if false;/);
  });

  it("keeps account backups restricted to their authenticated owner", () => {
    expect(rules).toMatch(/match \/accountSync\/\{uid\}\/\{document=\*\*\}[\s\S]*?request\.auth\.uid == uid/);
  });

  it("keeps direct hub-match writes scoped to the authenticated match owner", () => {
    expect(rules).toMatch(/match \/matches\/\{matchId\}[\s\S]*?belongsToHub\(hubId\)[\s\S]*?request\.resource\.data\.uid == request\.auth\.uid/);
  });

  it("keeps private-hub Web Replay pointers and grants server-authoritative", () => {
    expect(rules).toMatch(/allow create:[\s\S]*?!request\.resource\.data\.keys\(\)\.hasAny\(\['web_replay_id', 'webReplayId'\]\)/);
    expect(rules).toMatch(/allow update:[\s\S]*?request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)[\s\S]*?\.hasAny\(\['web_replay_id', 'webReplayId'\]\)/);
    expect(rules).toMatch(/match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
  });

  it("requires a real membership or ownership record for account-managed private hub reads", () => {
    expect(rules).toMatch(/function accountManagedHub\(hubId\)[\s\S]*?role_mode == 'account'/);
    expect(rules).toMatch(/function belongsToHub\(hubId\)[\s\S]*?members\/\$\(request\.auth\.uid\)/);
    expect(rules).toMatch(/match \/hubs\/\{hubId\}[\s\S]*?allow get: if belongsToHub\(hubId\)/);
  });

  it("does not retain creator ownership after an account owner is established", () => {
    expect(rules).toMatch(/function ownsHub\(hubId\)[\s\S]*?legacyCreatorMatches[\s\S]*?!accountManaged && legacyCreatorMatches/);
  });

  it("blocks direct account-managed lifecycle mutations and activity while server deletion is running", () => {
    expect(rules).toMatch(/function hubAcceptingActivity\(hubId\)[\s\S]*?lifecycle_state != 'deleting'/);
    expect(rules).toMatch(/allow update, delete: if ownsHub\(hubId\)[\s\S]*?!accountManagedHub\(hubId\)/);
    expect(rules).toMatch(/function belongsToHub\(hubId\)[\s\S]*?hubAcceptingActivity\(hubId\)/);
  });

  it("denies every collection that is not explicitly client-accessible", () => {
    expect(rules).toMatch(/match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/);
  });
});
