import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");

function run(cmd, args, label) {
  return spawn(cmd, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
}

console.log("Starting Firebase emulators + Next.js dev server…\n");
console.log("Emulator UI: http://127.0.0.1:4000");
console.log("App:         http://localhost:3000");
console.log("Login:       http://localhost:3000/register\n");

const emulators = run(
  "npx",
  [
    "firebase",
    "emulators:start",
    "--only",
    "auth,firestore,storage",
    "--project",
    "label-ai-local",
  ],
  "emulators"
);

let nextStarted = false;

function startNext() {
  if (nextStarted) return;
  nextStarted = true;
  setTimeout(() => {
    run("npx", ["next", "dev"], "next");
  }, 4000);
}

emulators.stdout?.on("data", (buf) => {
  const text = buf.toString();
  if (text.includes("All emulators ready")) startNext();
});

// firebase-tools logs to stderr
emulators.stderr?.on("data", (buf) => {
  const text = buf.toString();
  if (text.includes("All emulators ready")) startNext();
});

// Fallback if ready message not caught
setTimeout(startNext, 12000);

process.on("SIGINT", () => {
  emulators.kill("SIGINT");
  process.exit(0);
});
