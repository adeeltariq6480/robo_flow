import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, "..");

const dirs = [".next", path.join("node_modules", ".cache")];

for (const dir of dirs) {
  const full = path.join(projectRoot, dir);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log("Removed:", dir);
  }
}

console.log("Cache cleared. Run: npm run dev");
