/**
 * Sync Firebase env vars from .env.local to Vercel (production + preview).
 * Run: node scripts/sync-vercel-env.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";

const ENV_FILE = resolve(process.cwd(), ".env.local");

const KEYS = [
  "NEXT_PUBLIC_USE_FIREBASE_EMULATOR",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "NEXT_PUBLIC_WORKER_API_URL",
  "WORKER_URL",
  "WORKER_API_KEY",
];

function parseEnvFile(path) {
  const vars = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    vars[key] = val;
  }
  return vars;
}

function addEnv(key, value, environment) {
  const result = spawnSync(
    "npx",
    ["vercel", "env", "add", key, environment, "--force", "--yes"],
    {
      input: value,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    console.error(`FAIL ${key} (${environment}):`, result.stderr || result.stdout);
    return false;
  }
  console.log(`OK ${key} (${environment})`);
  return true;
}

if (!existsSync(ENV_FILE)) {
  console.error("Missing .env.local");
  process.exit(1);
}

const vars = parseEnvFile(ENV_FILE);
let failed = 0;

for (const key of KEYS) {
  const value = vars[key];
  if (value === undefined || value === "") {
    console.warn(`SKIP ${key} — empty in .env.local`);
    continue;
  }
  for (const env of ["production", "preview"]) {
    if (!addEnv(key, value, env)) failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} update(s) failed.`);
  process.exit(1);
}

console.log("\nDone. Redeploy: npx vercel deploy --prod --yes");
