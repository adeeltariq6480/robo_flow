import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  getFirebaseProjectId,
  getFirebaseStorageBucket,
  useFirebaseEmulator,
} from "@/lib/firebase/config";

function ensureEmulatorEnv() {
  if (!useFirebaseEmulator()) return;
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
}

let adminApp: App | undefined;

function loadServiceAccount(): Record<string, unknown> | undefined {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json?.trim()) return undefined;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

export function getAdminApp(): App {
  if (adminApp) return adminApp;
  if (getApps().length > 0) {
    adminApp = getApps()[0]!;
    return adminApp;
  }

  ensureEmulatorEnv();

  const projectId =
    getFirebaseProjectId() ||
    (useFirebaseEmulator() ? "label-ai-local" : "");
  const storageBucket =
    getFirebaseStorageBucket() ||
    (useFirebaseEmulator() ? "label-ai-local.appspot.com" : "");
  const serviceAccount = loadServiceAccount();

  if (!projectId) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID or NEXT_PUBLIC_FIREBASE_PROJECT_ID."
    );
  }

  // Emulator mode: no service account required
  if (useFirebaseEmulator() && !serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    adminApp = initializeApp({
      projectId,
      storageBucket,
    });
    return adminApp;
  }

  if (serviceAccount) {
    adminApp = initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId,
      storageBucket: storageBucket || undefined,
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    adminApp = initializeApp({
      projectId,
      storageBucket: storageBucket || undefined,
    });
  } else {
    throw new Error(
      "Firebase Admin requires FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS."
    );
  }

  return adminApp;
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function bucketName(): string {
  const bucket = getFirebaseStorageBucket();
  if (!bucket) throw new Error("FIREBASE_STORAGE_BUCKET is not configured.");
  return bucket.replace(/^gs:\/\//, "");
}
