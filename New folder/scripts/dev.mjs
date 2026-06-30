import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");
const nextDir = path.join(projectRoot, ".next");

function isCorruptNextCache() {
  if (!fs.existsSync(nextDir)) return false;

  const serverDir = path.join(nextDir, "server");
  const vendorChunks = path.join(serverDir, "vendor-chunks");
  const routesManifest = path.join(nextDir, "routes-manifest.json");

  // Typical failure: server bundle exists but vendor-chunks were deleted mid-run
  if (fs.existsSync(serverDir) && !fs.existsSync(vendorChunks)) {
    return true;
  }

  // Partial build after clean while dev server was still running
  if (fs.existsSync(serverDir) && !fs.existsSync(routesManifest)) {
    return true;
  }

  return false;
}

function cleanCache() {
  const dirs = [".next", path.join("node_modules", ".cache")];
  for (const dir of dirs) {
    const full = path.join(projectRoot, dir);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log("Removed:", dir);
    }
  }
}

if (isCorruptNextCache()) {
  console.log("Detected corrupt .next cache — cleaning before start…");
  cleanCache();
}

console.log("Starting Next.js dev server…");
console.log("Tip: use Ctrl+C then `npm run dev:clean` if vendor-chunks errors return.");
console.log("Do not run `npm run build` while dev is running.\n");

const child = spawn("npx", ["next", "dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
