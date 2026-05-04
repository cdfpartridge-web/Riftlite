import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function readServiceAccount(): FirebaseServiceAccount | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

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

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

export function isFirebaseAdminConfigured() {
  return Boolean(readServiceAccount());
}

function getAdminApp(): App | null {
  const serviceAccount = readServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  return (
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    })
  );
}

export function getFirestoreAdmin() {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}

/**
 * Verify a Firebase ID token issued to a signed-in desktop client.
 * Returns the decoded token (with .uid) on success, null on any failure
 * — malformed token, expired token, wrong project, admin SDK not
 * configured, etc. Callers must treat null as "unauthenticated" and
 * reject the request.
 *
 * This is a pure JWT verification against Google's public keys and
 * costs zero Firestore reads. See:
 *   https://firebase.google.com/docs/auth/admin/verify-id-tokens
 */
export async function verifyFirebaseIdToken(idToken: string) {
  const app = getAdminApp();
  if (!app) return null;

  try {
    return await getAuth(app).verifyIdToken(idToken);
  } catch {
    return null;
  }
}

export async function createFirebaseCustomToken(uid: string) {
  const app = getAdminApp();
  if (!app) return null;

  try {
    return await getAuth(app).createCustomToken(uid);
  } catch {
    return null;
  }
}
