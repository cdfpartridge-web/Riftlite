import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_DISPLAY_NAME = "RiftLite Player";
const GENERIC_DISPLAY_NAMES = new Set([
  DEFAULT_DISPLAY_NAME.toLowerCase(),
  "riftlite user",
  "a riftlite player",
  "player",
  "member",
  "owner",
]);

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

loadEnvFile(".env.prod.report.local");
loadEnvFile(".env.report.local");

const serviceAccount = readServiceAccount();
if (!serviceAccount) {
  console.error("Missing Firebase service account env. Expected FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_* vars.");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({
  credential: cert({
    projectId: serviceAccount.projectId,
    clientEmail: serviceAccount.clientEmail,
    privateKey: serviceAccount.privateKey,
  }),
});
const db = getFirestore(app);

const users = await db.collection("users").get();
const stats = {
  usersChecked: users.size,
  usersRepaired: 0,
  publicProfilesRepaired: 0,
  aggregatesRepaired: 0,
  hubMembersRepaired: 0,
  hubMessagesRepaired: 0,
  invitesRepaired: 0,
  inboxItemsRepaired: 0,
};

for (const userDoc of users.docs) {
  const uid = userDoc.id;
  const user = userDoc.data();
  const handle = cleanHandle(user.handle);
  const currentName = cleanName(user.displayName);
  const matchName = await latestMatchUsername(uid);
  const displayName = bestName(currentName, handle, matchName);
  if (isGeneric(displayName)) {
    continue;
  }

  const writes = [];
  if (isGeneric(currentName) || currentName !== displayName) {
    writes.push({
      ref: userDoc.ref,
      data: { displayName, updatedAt: Date.now() },
      stat: "usersRepaired",
    });
  }

  const handleLower = cleanName(user.handleLower || handle).toLowerCase();
  if (handleLower) {
    const publicProfileRef = db.collection("publicProfiles").doc(handleLower);
    const publicProfile = await publicProfileRef.get();
    if (publicProfile.exists) {
      const data = publicProfile.data() ?? {};
      if (isGeneric(data.displayName) || cleanName(data.displayName) !== displayName) {
        writes.push({
          ref: publicProfileRef,
          data: {
            displayName,
            handle,
            searchPrefixes: buildSearchPrefixes(handle, displayName),
            updatedAt: Date.now(),
          },
          stat: "publicProfilesRepaired",
        });
      }
    }
  }

  const aggregateRef = db.collection("userAggregates").doc(uid);
  const aggregate = await aggregateRef.get();
  if (aggregate.exists) {
    const data = aggregate.data() ?? {};
    if (isGeneric(data.displayName) || cleanName(data.displayName) !== displayName) {
      writes.push({
        ref: aggregateRef,
        data: { displayName, handle, updatedAt: Date.now() },
        stat: "aggregatesRepaired",
      });
    }
  }

  await collectCollectionGroupRepairs(writes, "members", "uid", uid, { displayName, handle, updatedAt: Date.now() }, "hubMembersRepaired");
  await collectCollectionGroupRepairs(writes, "messages", "uid", uid, { displayName, handle, updatedAt: Date.now() }, "hubMessagesRepaired");
  await collectCollectionGroupRepairs(writes, "inbox", "senderUid", uid, { senderDisplayName: displayName, senderHandle: handle, updatedAt: Date.now() }, "inboxItemsRepaired", "senderDisplayName");
  await collectQueryRepairs(writes, db.collection("hubInvites").where("senderUid", "==", uid).limit(200), { senderDisplayName: displayName, senderHandle: handle, updatedAt: Date.now() }, "invitesRepaired", "senderDisplayName");

  if (!writes.length) {
    continue;
  }

  if (apply) {
    let batch = db.batch();
    let count = 0;
    for (const write of writes) {
      batch.set(write.ref, write.data, { merge: true });
      stats[write.stat] += 1;
      count += 1;
      if (count === 450) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count) {
      await batch.commit();
    }
  } else {
    for (const write of writes) {
      stats[write.stat] += 1;
    }
  }
}

console.log(`RiftLite profile display-name repair ${apply ? "applied" : "dry run"}`);
console.log(JSON.stringify(stats, null, 2));
if (!apply) {
  console.log("Run with --apply to write these repairs.");
}

async function collectCollectionGroupRepairs(writes, collectionId, field, value, data, stat, displayField = "displayName") {
  await collectQueryRepairs(writes, db.collectionGroup(collectionId).where(field, "==", value).limit(200), data, stat, displayField);
}

async function collectQueryRepairs(writes, query, data, stat, displayField = "displayName") {
  const snap = await query.get().catch(() => null);
  for (const doc of snap?.docs ?? []) {
    const current = doc.data() ?? {};
    if (isGeneric(current[displayField]) || cleanName(current[displayField]) !== cleanName(data[displayField])) {
      writes.push({ ref: doc.ref, data, stat });
    }
  }
}

async function latestMatchUsername(uid) {
  const queries = [
    db.collection("matches").where("owner_uid", "==", uid).orderBy("created_at", "desc").limit(10),
    db.collection("matches").where("uid", "==", uid).orderBy("created_at", "desc").limit(10),
    db.collection("matches").where("owner_uid", "==", uid).limit(10),
    db.collection("matches").where("uid", "==", uid).limit(10),
  ];
  for (const query of queries) {
    const snap = await query.get().catch(() => null);
    const rows = snap?.docs
      .map((doc) => doc.data())
      .sort((a, b) => Number(b.created_at ?? b.createdAt ?? 0) - Number(a.created_at ?? a.createdAt ?? 0)) ?? [];
    for (const row of rows) {
      const name = bestName(row.username, row.owner_handle, row.ownerHandle);
      if (name) return name;
    }
  }
  return "";
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      return null;
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  return projectId && clientEmail && privateKey ? { projectId, clientEmail, privateKey } : null;
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function cleanHandle(value) {
  return String(value ?? "").trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}

function isGeneric(value) {
  const cleaned = cleanName(value).toLowerCase();
  return !cleaned || GENERIC_DISPLAY_NAMES.has(cleaned);
}

function bestName(...values) {
  for (const value of values) {
    const cleaned = cleanName(value);
    if (cleaned && !isGeneric(cleaned)) return cleaned;
  }
  return "";
}

function buildSearchPrefixes(...values) {
  const prefixes = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, " ").trim();
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      for (let index = 1; index <= Math.min(token.length, 24); index += 1) {
        prefixes.add(token.slice(0, index));
      }
    }
  }
  return Array.from(prefixes).slice(0, 80);
}
