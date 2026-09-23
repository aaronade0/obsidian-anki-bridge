import type { SyncConflict } from "./types";

/**
 * How long a failed note waits before its unchanged content is tried again.
 * Failures caused by an unreachable Anki are never retried blindly: the caller
 * first checks that AnkiConnect answers, so this only paces errors that
 * persist while Anki is running.
 */
export const SYNC_FAILURE_RETRY_DELAY_MS = 2 * 60_000;

/**
 * Notes whose last synchronization failed and whose content has not changed
 * since. A content-hash comparison alone never retries them, because the
 * registry already holds the hash of the content that failed to reach Anki.
 */
export function retryableSyncFailurePaths(
  conflicts: readonly SyncConflict[],
  now: number,
  retryDelayMs = SYNC_FAILURE_RETRY_DELAY_MS
): Set<string> {
  const paths = new Set<string>();
  for (const conflict of conflicts) {
    if (
      conflict.code === "SYNC_FAILED" &&
      conflict.resolvedAt === undefined &&
      conflict.path &&
      now - conflict.lastSeenAt >= retryDelayMs
    ) {
      paths.add(conflict.path);
    }
  }
  return paths;
}
