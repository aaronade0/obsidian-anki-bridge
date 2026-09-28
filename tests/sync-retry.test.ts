import { describe, expect, it } from "vitest";
import {
  isConnectionStatusEntry,
  retryableSyncFailurePaths,
  SYNC_FAILURE_RETRY_DELAY_MS,
  SYNC_PENDING
} from "../src/sync-retry";
import type { SyncConflict } from "../src/types";

function conflict(overrides: Partial<SyncConflict>): SyncConflict {
  return {
    key: "k",
    code: "SYNC_FAILED",
    severity: "error",
    message: "AnkiConnect ist nicht erreichbar",
    path: "Note.md",
    createdAt: 0,
    lastSeenAt: 0,
    ...overrides
  };
}

describe("retryableSyncFailurePaths", () => {
  const now = 10 * SYNC_FAILURE_RETRY_DELAY_MS;

  it("retries an open failure once the retry delay has passed", () => {
    expect(retryableSyncFailurePaths([conflict({})], now)).toEqual(new Set(["Note.md"]));
  });

  it("waits for the retry delay after the last attempt", () => {
    const recent = conflict({ lastSeenAt: now - SYNC_FAILURE_RETRY_DELAY_MS + 1 });
    expect(retryableSyncFailurePaths([recent], now).size).toBe(0);
  });

  it("ignores resolved failures, other codes, and failures without a note", () => {
    const conflicts = [
      conflict({ path: "Resolved.md", resolvedAt: 1 }),
      conflict({ path: "Warning.md", code: "RENDER_WARNING" }),
      conflict({ path: undefined })
    ];
    expect(retryableSyncFailurePaths(conflicts, now).size).toBe(0);
  });

  it("retries a note that waited for Anki without any delay", () => {
    const pending = conflict({ code: SYNC_PENDING, lastSeenAt: now });
    expect(retryableSyncFailurePaths([pending], now)).toEqual(new Set(["Note.md"]));
    expect(retryableSyncFailurePaths([{ ...pending, resolvedAt: now }], now).size).toBe(0);
  });
});

describe("isConnectionStatusEntry", () => {
  it("keeps connection states out of the conflict report", () => {
    expect(isConnectionStatusEntry(conflict({ code: SYNC_PENDING }))).toBe(true);
    expect(isConnectionStatusEntry(conflict({ code: "ANKI_UNREACHABLE" }))).toBe(true);
    expect(isConnectionStatusEntry(conflict({}))).toBe(false);
  });
});
