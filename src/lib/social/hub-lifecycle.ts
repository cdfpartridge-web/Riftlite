import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Query,
} from "firebase-admin/firestore";

import { deletePrivateHubAggregateRecords } from "@/lib/community/data";

const HUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DELETE_BATCH_SIZE = 400;

export type HubLifecycleErrorCode =
  | "hub_not_found"
  | "hub_deleting"
  | "private_hub_required"
  | "primary_owner_required"
  | "owner_must_delete"
  | "invalid_hub_id";

export class HubLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: HubLifecycleErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "HubLifecycleError";
  }
}

export type LeavePrivateHubResult = {
  hubId: string;
  left: boolean;
  alreadyLeft: boolean;
};

export type DeletePrivateHubResult = {
  hubId: string;
  deleted: boolean;
  alreadyDeleted: boolean;
};

/** Remove every membership document attached to the signed-in identity. */
export async function leavePrivateHub(
  db: Firestore,
  hubIdInput: string,
  identityUidsInput: readonly string[],
): Promise<LeavePrivateHubResult> {
  const hubId = cleanHubId(hubIdInput);
  const identityUids = cleanIdentityUids(identityUidsInput);
  const hubRef = db.collection("hubs").doc(hubId);
  const hubSnap = await hubRef.get();
  if (!hubSnap.exists) {
    throw new HubLifecycleError("Hub not found.", "hub_not_found", 404);
  }
  const hub = hubSnap.data() ?? {};
  assertAccountManagedPrivateHub(hub);
  if (String(hub.lifecycle_state ?? "") === "deleting") {
    throw new HubLifecycleError("This hub is being deleted.", "hub_deleting", 409);
  }
  if (identityUids.includes(primaryOwnerUid(hub))) {
    throw new HubLifecycleError(
      "The primary owner cannot leave their hub. Delete the hub instead.",
      "owner_must_delete",
      409,
    );
  }

  const memberRefs = identityUids.map((uid) => hubRef.collection("members").doc(uid));
  const memberSnaps = memberRefs.length ? await db.getAll(...memberRefs) : [];
  const existing = memberSnaps.filter((member) => member.exists);
  if (!existing.length) {
    return { hubId, left: false, alreadyLeft: true };
  }

  const batch = db.batch();
  for (const member of existing) batch.delete(member.ref);
  await batch.commit();
  return { hubId, left: true, alreadyLeft: false };
}

/**
 * Delete an account-managed private hub and every server-side reference to it.
 *
 * The hub document is marked as deleting before cleanup and is removed last.
 * That prevents new activity and leaves the primary owner's authorization in
 * place if cleanup fails, allowing the same operation to be retried safely.
 */
export async function deletePrivateHub(
  db: Firestore,
  hubIdInput: string,
  identityUidsInput: readonly string[],
): Promise<DeletePrivateHubResult> {
  const hubId = cleanHubId(hubIdInput);
  const identityUids = cleanIdentityUids(identityUidsInput);
  const hubRef = db.collection("hubs").doc(hubId);

  const start = await db.runTransaction(async (tx) => {
    const hubSnap = await tx.get(hubRef);
    if (!hubSnap.exists) return "missing" as const;
    const hub = hubSnap.data() ?? {};
    assertAccountManagedPrivateHub(hub);
    if (!identityUids.includes(primaryOwnerUid(hub))) {
      throw new HubLifecycleError(
        "Only the primary hub owner can delete this hub.",
        "primary_owner_required",
        403,
      );
    }
    tx.set(hubRef, {
      lifecycle_state: "deleting",
      deletion_started_at: Number(hub.deletion_started_at ?? Date.now()) || Date.now(),
      updated_at: Date.now(),
    }, { merge: true });
    return "ready" as const;
  });

  if (start === "missing") {
    return { hubId, deleted: false, alreadyDeleted: true };
  }

  await Promise.all([
    deleteFlatQuery(db, () => db.collection("hubInvites").where("hubId", "==", hubId).limit(DELETE_BATCH_SIZE)),
    deleteFlatQuery(db, () => db.collectionGroup("inbox").where("hubId", "==", hubId).limit(DELETE_BATCH_SIZE)),
    deleteFlatQuery(db, () => db.collection("replayDiscordShares").where("hubId", "==", hubId).limit(DELETE_BATCH_SIZE)),
    deleteFlatQuery(db, () => db.collection("replayHubGrants").where("hubId", "==", hubId).limit(DELETE_BATCH_SIZE)),
    deletePrivateHubAggregateRecords(db, hubId),
  ]);

  await deleteDocumentQueryTrees(
    db,
    () => db.collection("discordGuildConfigs").where("hubId", "==", hubId).limit(50),
  );
  await deleteDocumentTree(db, hubRef);
  return { hubId, deleted: true, alreadyDeleted: false };
}

export function primaryOwnerUid(hub: DocumentData): string {
  return String(hub.owner_uid ?? hub.ownerUid ?? hub.created_by ?? hub.createdBy ?? "").trim();
}

function assertAccountManagedPrivateHub(hub: DocumentData): void {
  if (String(hub.role_mode ?? hub.roleMode ?? "") !== "account") {
    throw new HubLifecycleError(
      "This action is available only for account-managed private hubs.",
      "private_hub_required",
      409,
    );
  }
}

function cleanHubId(value: string): string {
  const hubId = value.trim();
  if (!HUB_ID_PATTERN.test(hubId)) {
    throw new HubLifecycleError("Invalid hub id.", "invalid_hub_id", 400);
  }
  return hubId;
}

function cleanIdentityUids(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function deleteFlatQuery(
  db: Firestore,
  createQuery: () => Query<DocumentData>,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await createQuery().get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    deleted += snapshot.size;
  }
}

async function deleteDocumentQueryTrees(
  db: Firestore,
  createQuery: () => Query<DocumentData>,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await createQuery().get();
    if (snapshot.empty) return deleted;
    for (const document of snapshot.docs) {
      await deleteDocumentTree(db, document.ref);
      deleted += 1;
    }
  }
}

async function deleteDocumentTree(
  db: Firestore,
  documentRef: DocumentReference<DocumentData>,
): Promise<void> {
  const childCollections = await documentRef.listCollections();
  for (const collection of childCollections) {
    await db.recursiveDelete(collection);
  }
  await documentRef.delete();
}
