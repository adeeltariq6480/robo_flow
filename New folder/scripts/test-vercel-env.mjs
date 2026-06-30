/**
 * Validates Vercel-pulled env without printing secrets.
 * Usage: node scripts/test-vercel-env.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.vercel");
let raw;
try {
  raw = readFileSync(envPath, "utf8");
} catch {
  console.error("Missing .env.vercel — run: npx vercel env pull .env.vercel --environment production --yes");
  process.exit(1);
}

const vars = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  vars[m[1]] = val;
}

const required = [
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
];

for (const key of required) {
  console.log(`${key}: ${vars[key]?.trim() ? "set" : "MISSING"}`);
}

const json = vars.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
if (!json) {
  process.exit(1);
}

try {
  const sa = JSON.parse(json);
  if (!sa.private_key || !sa.client_email) {
    console.error("PARSE: missing private_key or client_email");
    process.exit(1);
  }
  console.log("PARSE: OK");
  console.log("PROJECT:", sa.project_id);
} catch (e) {
  console.error("PARSE_ERROR:", e.message);
  process.exit(1);
}
