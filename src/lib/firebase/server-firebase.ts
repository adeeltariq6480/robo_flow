import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from "firebase/storage";
import {
  resolveFirebaseClientConfig,
  useFirebaseEmulator,
} from "@/lib/firebase/config";

const SERVER_APP_NAME = "label-ai-server";

let serverApp: FirebaseApp | undefined;
let emulatorsConnected = false;

function connectServerEmulators(app: FirebaseApp) {
  if (emulatorsConnected || !useFirebaseEmulator()) return;
  connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);
  connectStorageEmulator(getStorage(app), "127.0.0.1", 9199);
  emulatorsConnected = true;
}

export function getServerFirebaseApp(): FirebaseApp {
  if (serverApp) return serverApp;
  const existing = getApps().find((a) => a.name === SERVER_APP_NAME);
  if (existing) {
    serverApp = existing;
    connectServerEmulators(serverApp);
    return serverApp;
  }
  serverApp = initializeApp(resolveFirebaseClientConfig(), SERVER_APP_NAME);
  connectServerEmulators(serverApp);
  return serverApp;
}

export function getServerFirestore(): Firestore {
  return getFirestore(getServerFirebaseApp());
}

export function getServerStorage(): FirebaseStorage {
  return getStorage(getServerFirebaseApp());
}
