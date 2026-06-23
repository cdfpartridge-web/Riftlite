import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const AGGREGATE_COLLECTION = "aggregates";
const AGGREGATE_DOC_ID = "community-v1";
const PRIVATE_COUNTER_DOC_ID = "community-private-counters";
const PRIVATE_MATCH_INDEX_COLLECTION = "privateHubMatchIndex";
const PRIVATE_PLAYER_INDEX_COLLECTION = "privateHubPlayers";

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

const hubsSnap = await db.collection("hubs").get();
const playerCounts = new Map();
const matchIndexRows = [];

for (const hub of hubsSnap.docs) {
  const matchesSnap = await db
    .collection("hubs")
    .doc(hub.id)
    .collection("matches")
    .select("uid", "username", "created_at")
    .get();

  for (const match of matchesSnap.docs) {
    const uid = String(match.get("uid") ?? "").trim();
    if (!uid) continue;
    const username = String(match.get("username") ?? "").trim();
    matchIndexRows.push({
      docId: privateHubMatchDocId(hub.id, match.id),
      hubId: hub.id,
      matchId: match.id,
      uid,
      username,
      createdAt: Number(match.get("created_at") ?? 0),
    });
    const existing = playerCounts.get(uid) ?? { username, matchCount: 0 };
    playerCounts.set(uid, {
      username: existing.username || username,
      matchCount: existing.matchCount + 1,
    });
  }
}

const stats = {
  hubsChecked: hubsSnap.size,
  privateMatchCount: matchIndexRows.length,
  privatePlayerCount: playerCounts.size,
};

console.log(JSON.stringify({ apply, ...stats }, null, 2));

if (!apply) {
  console.log("Dry run only. Re-run with --apply to write cached private counters.");
  process.exit(0);
}

const now = Date.now();
await writeBatched(matchIndexRows, (batch, row) => {
  batch.set(db.collection(PRIVATE_MATCH_INDEX_COLLECTION).doc(row.docId), {
    hubId: row.hubId,
    matchId: row.matchId,
    uid: row.uid,
    username: row.username,
    createdAt: row.createdAt || now,
    backfilledAt: now,
  });
});

await writeBatched(Array.from(playerCounts.entries()), (batch, [uid, player]) => {
  batch.set(db.collection(PRIVATE_PLAYER_INDEX_COLLECTION).doc(publicPlayerDocId(uid)), {
    uid,
    username: player.username,
    matchCount: player.matchCount,
    updatedAt: now,
    backfilledAt: now,
  });
});

const counterPayload = {
  privateMatchCount: stats.privateMatchCount,
  privatePlayerCount: stats.privatePlayerCount,
  updatedAt: now,
  backfilledAt: now,
};
await Promise.all([
  db.collection(AGGREGATE_COLLECTION).doc(PRIVATE_COUNTER_DOC_ID).set(counterPayload, { merge: true }),
  db.collection(AGGREGATE_COLLECTION).doc(AGGREGATE_DOC_ID).set(counterPayload, { merge: true }),
]);

console.log("Private community counters backfilled.");

async function writeBatched(items, write) {
  let batch = db.batch();
  let count = 0;
  for (const item of items) {
    write(batch, item);
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }
}

function privateHubMatchDocId(hubId, matchId) {
  return encodeURIComponent(`${String(hubId).trim()}::${String(matchId).trim()}`);
}

function publicPlayerDocId(uid) {
  return encodeURIComponent(String(uid).trim());
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
