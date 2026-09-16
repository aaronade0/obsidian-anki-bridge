import type { RegistryCard, RegistryFile, SyncConflict } from "./types";

/**
 * Decides which vanished source notes are worth reporting.
 *
 * A note that disappeared outside Obsidian is only a problem when registered
 * Anki cards still point at it. Notes that never carried cards are forgotten
 * silently instead of piling up as unresolvable read failures.
 */

/**
 * Obsidian surfaces vanished files as raw filesystem errors on desktop and as
 * plain messages on other adapters, so both shapes are recognized.
 */
export function isMissingFileError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };
    if (code === "ENOENT" || code === "ENOTDIR") {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|no such file|not found|does not exist/i.test(message);
}

export function hasRegisteredCards(file: RegistryFile, cards: readonly RegistryCard[]): boolean {
  return cards.some((card) => card.fileKey === file.key);
}

/**
 * Registered notes that are gone from the vault and hold no cards. They can be
 * dropped from the registry without telling the user anything.
 */
export function forgettableRegistryFiles(
  files: readonly RegistryFile[],
  cards: readonly RegistryCard[],
  existingPaths: ReadonlySet<string>
): RegistryFile[] {
  return files.filter(
    (file) =>
      file.missingReason !== "deleted-in-obsidian" &&
      !existingPaths.has(file.path) &&
      !hasRegisteredCards(file, cards)
  );
}

/**
 * Unresolved read failures that may be stale leftovers from a vanished note
 * without cards. The caller still has to confirm that the path is really gone
 * before resolving them.
 */
export function prunableSyncFailures(
  conflicts: readonly SyncConflict[],
  files: readonly RegistryFile[],
  cards: readonly RegistryCard[]
): SyncConflict[] {
  return conflicts.filter((conflict) => {
    if (conflict.code !== "SYNC_FAILED" || conflict.resolvedAt !== undefined || !conflict.path) {
      return false;
    }
    const registered = files.find((file) => file.path === conflict.path);
    return registered === undefined || !hasRegisteredCards(registered, cards);
  });
}
