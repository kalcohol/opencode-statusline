import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await fs.copyFile(path.join(root, "src", "tui.tsx"), path.join(root, "dist", "tui.tsx"));
await fs.rm(path.join(root, "dist", "tui.jsx"), { force: true });
await fs.rm(path.join(root, "dist", "tui.jsx.map"), { force: true });
