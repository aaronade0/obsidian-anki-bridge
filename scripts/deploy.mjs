import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const vaultRoot = mode === "test"
  ? join(projectRoot, "test-vault")
  : process.env.OAB_VAULT_PATH;
const configDirectory = mode === "test"
  ? ".obsidian"
  : (process.env.OAB_CONFIG_DIR ?? ".obsidian");

if (mode !== "test" && mode !== "vault") {
  throw new Error("Usage: node scripts/deploy.mjs test|vault");
}
if (!vaultRoot) {
  throw new Error("OAB_VAULT_PATH is required for a real-vault deployment.");
}
if (mode === "vault" && resolve(vaultRoot) === resolve("/")) {
  throw new Error("Refusing to deploy to a filesystem root.");
}
if (
  mode === "vault"
  && (configDirectory === "" || configDirectory === "." || configDirectory === ".."
    || configDirectory.includes("/") || configDirectory.includes("\\"))
) {
  throw new Error("OAB_CONFIG_DIR must be a single vault-relative directory name.");
}

const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
const destination = join(resolve(vaultRoot), configDirectory, "plugins", manifest.id);
await mkdir(destination, { recursive: true });
for (const filename of ["main.js", "manifest.json", "styles.css", "README.md"]) {
  await copyFile(join(projectRoot, filename), join(destination, filename));
}
await copyFile(
  join(projectRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
  join(destination, "pdf.worker.min.mjs")
);
process.stdout.write(`Deployed ${manifest.name} to ${destination}\n`);
