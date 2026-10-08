import { describe, expect, it } from "vitest";
import { resolveDiscordAccountUid } from "@/lib/discord/account-registration";

const discordUserId = "123456789012345678";

describe("Discord account registration", () => {
  it("creates one server-owned authentication binding and reuses it on later sign-ins", async () => {
    const db = fakeDb();
    const uid = await resolveDiscordAccountUid(db as never, discordUserId);
    expect(uid).toMatch(/^discord_[a-f0-9-]{36}$/);
    expect(await resolveDiscordAccountUid(db as never, discordUserId)).toBe(uid);
    expect([...db.records.keys()]).toEqual([`discordAccountIdentities/${discordUserId}`]);
    expect(db.records.get(`discordAccountIdentities/${discordUserId}`)).toEqual({
      uid, discordUserId, createdAt: expect.any(Number),
    });
  });

  it("uses all historical guild links and canonical aliases before creating any new account", async () => {
    const db = fakeDb({ links: [{ uid: "old" }, { uid: "account" }], records: {
      "identityAliases/old": { canonicalUid: "account" },
    } });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).resolves.toBe("account");
    expect(db.records.get(`discordAccountIdentities/${discordUserId}`)?.uid).toBe("account");
  });

  it("follows a subsequent canonical migration without replacing its original Discord binding", async () => {
    const db = fakeDb({ records: {
      [`discordAccountIdentities/${discordUserId}`]: { uid: "old" },
      "identityAliases/old": { canonicalUid: "current" },
    } });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).resolves.toBe("current");
    expect(db.records.get(`discordAccountIdentities/${discordUserId}`)?.uid).toBe("old");
  });

  it("does not create or rebind an identity when a desktop reconnect expects a different account", async () => {
    const empty = fakeDb();
    await expect(resolveDiscordAccountUid(empty as never, discordUserId, "existing-account")).rejects.toThrow("stored on this device");
    expect(empty.records.size).toBe(0);
    const linked = fakeDb({ links: [{ uid: "other-account" }] });
    await expect(resolveDiscordAccountUid(linked as never, discordUserId, "existing-account")).rejects.toThrow("stored on this device");
    expect(linked.records.size).toBe(0);
  });

  it("allows a pinned reconnect only to the proven canonical account", async () => {
    const db = fakeDb({ links: [{ uid: "existing-account" }] });
    await expect(resolveDiscordAccountUid(db as never, discordUserId, "existing-account")).resolves.toBe("existing-account");
  });

  it("fails closed for conflicting historical accounts beyond the first 50 links", async () => {
    const db = fakeDb({ links: [...Array.from({ length: 50 }, () => ({ uid: "one" })), { uid: "two" }] });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).rejects.toThrow("more than one");
    expect(db.records.size).toBe(0);
  });

  it("does not replace a sign-up identity with another account from a later guild verification", async () => {
    const db = fakeDb({ links: [{ uid: "other" }], records: {
      [`discordAccountIdentities/${discordUserId}`]: { uid: "original" },
    } });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).rejects.toThrow("more than one");
    expect(db.records.get(`discordAccountIdentities/${discordUserId}`)?.uid).toBe("original");
  });

  it("does not invent a new identity when Firestore reads fail", async () => {
    const db = fakeDb({ readError: true });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).rejects.toThrow("read failed");
    expect(db.records.size).toBe(0);
  });

  it.each<Record<string, Record<string, unknown>>>([
    { "identityAliases/old": { canonicalUid: "other" }, "users/old": { canonicalUid: "different" } },
    { "identityAliases/old": { canonicalUid: "loop" }, "identityAliases/loop": { canonicalUid: "old" } },
  ])("rejects conflicting or cyclic canonical identity records", async (records) => {
    const db = fakeDb({ links: [{ uid: "old" }], records });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).rejects.toThrow("conflicting identity");
    expect(db.records.has(`discordAccountIdentities/${discordUserId}`)).toBe(false);
  });

  it.each(["", "../other", "discord-name", "1234"])("rejects non-Discord identifiers: %s", async (id) => {
    const db = fakeDb();
    await expect(resolveDiscordAccountUid(db as never, id)).rejects.toThrow("valid account identity");
    expect(db.records.size).toBe(0);
  });

  it("retries against the winner when two first sign-ins race", async () => {
    const db = fakeDb({ racedUid: "first-registration" });
    await expect(resolveDiscordAccountUid(db as never, discordUserId)).resolves.toBe("first-registration");
    expect(db.records.get(`discordAccountIdentities/${discordUserId}`)?.uid).toBe("first-registration");
  });
});

function fakeDb(input: {
  links?: Array<{ uid: string }>;
  records?: Record<string, Record<string, unknown>>;
  readError?: boolean;
  racedUid?: string;
} = {}) {
  const records = new Map<string, Record<string, unknown>>(Object.entries(input.records ?? {}));
  const snapshot = (path: string) => ({ exists: records.has(path), data: () => records.get(path) });
  const tx = {
    get: async (ref: { path?: string; query?: true }) => {
      if (input.readError) throw new Error("Firestore read failed");
      return ref.query ? { docs: (input.links ?? []).map((link) => ({ data: () => link })) } : snapshot(ref.path!);
    },
    create: (ref: { path: string }, data: Record<string, unknown>) => {
      if (input.racedUid && !records.has(ref.path)) {
        records.set(ref.path, { uid: input.racedUid });
        throw new Error("retry-transaction");
      }
      if (records.has(ref.path)) throw new Error("already-exists");
      records.set(ref.path, data);
    },
  };
  return {
    records,
    collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }), where: () => ({ query: true }) }),
    runTransaction: async (action: (tx: unknown) => Promise<string>) => {
      try { return await action(tx); }
      catch (error) {
        if (error instanceof Error && error.message === "retry-transaction") return action(tx);
        throw error;
      }
    },
  };
}
