/**
 * Shared Firebase configuration (client + server).
 */

const PLACEHOLDER_PATTERNS = [
  "your-project",
  "your-api-key",
  "example.com",
  "xxxxxxxx",
];

function isPlaceholder(value: string | undefined): boolean {
  if (!value || value.trim() === "") return true;
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export function getFirebaseClientConfig(): FirebaseClientConfig {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (
    isPlaceholder(apiKey) ||
    isPlaceholder(projectId) ||
    isPlaceholder(storageBucket)
  ) {
    throw new Error(
      "Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* variables in .env.local."
    );
  }

  return {
    apiKey: apiKey!,
    authDomain: authDomain ?? `${projectId}.firebaseapp.com`,
    projectId: projectId!,
    storageBucket: storageBucket!,
    messagingSenderId: messagingSenderId ?? "",
    appId: appId ?? "",
  };
}

export function getFirebaseProjectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ""
  );
}

export function getFirebaseStorageBucket(): string {
  return (
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    ""
  );
}

export function useFirebaseEmulator(): boolean {
  return process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
}

export function isFirebaseConfigured(): boolean {
  if (useFirebaseEmulator()) return true;
  try {
    getFirebaseClientConfig();
    return true;
  } catch {
    return false;
  }
}

/** Client config — uses demo values when emulators are enabled. */
export function resolveFirebaseClientConfig(): FirebaseClientConfig {
  if (useFirebaseEmulator()) {
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "label-ai-local";
    return {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "localhost",
      projectId,
      storageBucket:
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
        `${projectId}.appspot.com`,
      messagingSenderId:
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
      appId:
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
        "1:000000000000:web:demo",
    };
  }
  return getFirebaseClientConfig();
}
