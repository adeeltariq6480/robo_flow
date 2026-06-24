/**
 * Validates Firebase environment variables.
 * Run: npm run check:firebase
 */

const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

const required = [
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
];

const missing = required.filter((k) => !process.env[k]?.trim());

if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  console.error("Copy .env.example to .env.local");
  process.exit(1);
}

if (emulator) {
  console.log("OK — Firebase emulator mode (label-ai-local)");
  console.log("  Run: npm run emulators  (separate terminal)");
  console.log("  Or:  npm run dev:emulator");
} else {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    console.warn(
      "WARN — FIREBASE_SERVICE_ACCOUNT_JSON not set (required for production server actions)"
    );
  }
  console.log("OK — Firebase production mode");
  console.log("  Project:", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
}

process.exit(0);
