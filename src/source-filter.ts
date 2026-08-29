import type { PluginSettings } from "./types";

export type SourceFilterSettings = Pick<
  PluginSettings,
  "excludedPaths" | "excludedFilenamePatterns" | "includedFolders"
>;

/**
 * Returns whether a Markdown source path may be synchronized.
 *
 * Inclusion folders form an optional allowlist. Exclusions are evaluated
 * afterwards and therefore always win. Matching is case-insensitive so the
 * same settings behave consistently when a vault is used across devices with
 * different filesystem case rules.
 */
export function isSourcePathAllowed(path: string, settings: SourceFilterSettings): boolean {
  const normalizedPath = normalizeVaultPath(path);
  const included = cleanEntries(settings.includedFolders);
  if (included.length > 0 && !included.some((folder) => pathIsInsideFolder(normalizedPath, folder))) {
    return false;
  }

  const excludedPaths = cleanEntries(settings.excludedPaths);
  if (excludedPaths.some((pattern) => matchesPathPattern(normalizedPath, pattern))) {
    return false;
  }

  const filename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
  const excludedNames = cleanEntries(settings.excludedFilenamePatterns);
  return !excludedNames.some((pattern) => matchesFilenamePattern(filename, pattern));
}

export function parseFilterEntries(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function cleanEntries(entries: string[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/")
    .toLocaleLowerCase();
}

function pathIsInsideFolder(path: string, rawFolder: string): boolean {
  const folder = normalizeVaultPath(rawFolder);
  if (folder === "" || folder === "." || folder === "*") {
    return true;
  }
  return path === folder || path.startsWith(`${folder}/`);
}

function matchesPathPattern(path: string, rawPattern: string): boolean {
  const pattern = normalizeVaultPath(rawPattern);
  if (pattern === "" || pattern === ".") {
    return false;
  }
  if (!containsWildcard(pattern)) {
    return path === pattern || path.startsWith(`${pattern}/`);
  }
  return globToRegExp(pattern).test(path);
}

function matchesFilenamePattern(filename: string, rawPattern: string): boolean {
  const pattern = rawPattern.trim().toLocaleLowerCase();
  if (pattern.length === 0) {
    return false;
  }
  if (!containsWildcard(pattern)) {
    return filename.includes(pattern);
  }
  return globToRegExp(pattern).test(filename);
}

function containsWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") {
      source += ".*";
    } else if (character === "?") {
      source += ".";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
}
