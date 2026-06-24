"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
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

let app: FirebaseApp | undefined;
let emulatorsConnected = false;

function ensureEmulators() {
  if (emulatorsConnected || !useFirebaseEmulator()) return;
  const firebaseApp = getFirebaseApp();
  connectAuthEmulator(getAuth(firebaseApp), "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(getFirestore(firebaseApp), "127.0.0.1", 8080);
  connectStorageEmulator(getStorage(firebaseApp), "127.0.0.1", 9199);
  emulatorsConnected = true;
}

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0]!;
    return app;
  }
  app = initializeApp(resolveFirebaseClientConfig());
  return app;
}

export function getClientAuth(): Auth {
  ensureEmulators();
  return getAuth(getFirebaseApp());
}

export function getClientDb(): Firestore {
  ensureEmulators();
  return getFirestore(getFirebaseApp());
}

export function getClientStorage(): FirebaseStorage {
  ensureEmulators();
  return getStorage(getFirebaseApp());
}
