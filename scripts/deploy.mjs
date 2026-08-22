import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const vaultRoot = mode === "test"
  ? join(projectRoot, "test-vault")
  : process.env.OAB_VAULT_PATH;

if (mode !== "test" && mode !== "vault") {
  throw new Error("Usage: node scripts/deploy.mjs test|vault");
}
if (!vaultRoot) {
  throw new Error("OAB_VAULT_PATH is required for a real-vault deployment.");
}
if (mode === "vault" && resolve(vaultRoot) === resolve("/")) {
  throw new Error("Refusing to deploy to a filesystem root.");
}

const destination = join(resolve(vaultRoot), ".obsidian", "plugins", "obsidian-anki-bridge");
await mkdir(destination, { recursive: true });
for (const filename of ["main.js", "manifest.json", "styles.css", "README.md"]) {
  await copyFile(join(projectRoot, filename), join(destination, filename));
}
await copyFile(
  join(projectRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  join(destination, "pdf.worker.min.mjs")
);
process.stdout.write(`Deployed Obsidian Anki Bridge to ${destination}\n`);
