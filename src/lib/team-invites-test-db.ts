import type { Firestore, Transaction } from "firebase-admin/firestore";

type Data = Record<string, unknown>;
type Ref = { id: string; path: string; get(): Promise<Snapshot>; collection(name: string): Query };
type Snapshot = { id: string; exists: boolean; ref: Ref; data(): Data | undefined };
type Query = {
  path: string;
  doc(id: string): Ref;
  where(field: string, operation: string, value: unknown): Query;
  limit(count: number): Query;
  orderBy(field: string, direction?: "asc" | "desc"): Query;
  get(): Promise<{ docs: Snapshot[]; empty: boolean }>;
};

/** Transactions discard staged writes and retry whenever any read changes. */
export function fakeTeamInviteDatabase(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const versions = new Map<string, number>();
  const fake = {
    db: undefined as unknown as Firestore,
    commits: [] as string[][],
    attempts: 0,
    beforeCommit: undefined as (() => void) | undefined,
    queries: [] as Array<{ path: string; filters: Array<[string, string, unknown]>; cap: number }>,
    get: (path: string) => records.has(path) ? { ...records.get(path) } : undefined,
    set(path: string, value: Data) { records.set(path, { ...value }); versions.set(path, (versions.get(path) ?? 0) + 1); },
    patch(path: string, value: Data) { fake.set(path, { ...records.get(path), ...value }); },
    remove(path: string) { records.delete(path); versions.set(path, (versions.get(path) ?? 0) + 1); },
  };
  function snapshot(path: string): Snapshot {
    const value = fake.get(path);
    return { id: path.split("/").at(-1)!, ref: ref(path), exists: value !== undefined, data: () => value };
  }
  function ref(path: string): Ref {
    return { id: path.split("/").at(-1)!, path, get: async () => snapshot(path), collection: (name) => query(`${path}/${name}`) };
  }
  function query(path: string, filters: Array<[string, string, unknown]> = [], cap = 999, ordering?: [string, "asc" | "desc"]): Query {
    return {
      path,
      doc: (id) => ref(`${path}/${id}`),
      where: (field, operation, value) => query(path, [...filters, [field, operation, value]], cap, ordering),
      limit: (count) => query(path, filters, count, ordering),
      orderBy: (field, direction = "asc") => query(path, filters, cap, [field, direction]),
      get: async () => {
        fake.queries.push({ path, filters, cap });
        const docs = [...records.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
          .filter((key) => filters.every(([field, operation, value]) => operation === "in"
            ? Array.isArray(value) && value.includes(records.get(key)?.[field])
            : operation === ">" ? Number(records.get(key)?.[field]) > Number(value)
              : records.get(key)?.[field] === value))
          .sort((left, right) => ordering
            ? (Number(records.get(left)?.[ordering[0]]) - Number(records.get(right)?.[ordering[0]])) * (ordering[1] === "desc" ? -1 : 1) : 0)
          .slice(0, cap).map(snapshot);
        return { docs, empty: !docs.length };
      },
    };
  }
  fake.db = {
    collection: (name: string) => query(name),
    getAll: (...refs: Ref[]) => Promise.all(refs.map((document) => document.get())),
    runTransaction: async <T>(callback: (tx: Transaction) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        fake.attempts += 1;
        const reads = new Map<string, number>();
        const writes = new Map<string, Data>();
        const result = await callback({
          get: async (document: Ref | Query) => {
            if (writes.size) throw new Error("Read after write");
            if ("id" in document) {
              reads.set(document.path, versions.get(document.path) ?? 0);
              return snapshot(document.path);
            }
            return document.get();
          },
          set: (document: Ref, value: Data, options?: { merge: boolean }) => {
            writes.set(document.path, options?.merge ? { ...records.get(document.path), ...value } : { ...value });
          },
        } as unknown as Transaction);
        const conflict = fake.beforeCommit;
        fake.beforeCommit = undefined;
        conflict?.();
        if ([...reads].some(([path, version]) => version !== (versions.get(path) ?? 0))) continue;
        for (const [path, value] of writes) fake.set(path, value);
        if (writes.size) fake.commits.push([...writes.keys()]);
        return result;
      }
      throw new Error("Too many transaction retries");
    },
  } as unknown as Firestore;
  return fake;
}
