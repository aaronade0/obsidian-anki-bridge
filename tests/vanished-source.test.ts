import { describe, expect, it } from "vitest";
import {
  forgettableRegistryFiles,
  hasRegisteredCards,
  isMissingFileError,
  prunableSyncFailures
} from "../src/vanished-source";
import type { RegistryCard, RegistryFile, SyncConflict } from "../src/types";

function registryFile(key: string, path: string, overrides: Partial<RegistryFile> = {}): RegistryFile {
  return { key, path, contentHash: `hash-${key}`, lastSeen: 1, ...overrides };
}

function registryCard(key: string, fileKey: string): RegistryCard {
  return {
    key,
    fileKey,
    sourcePath: "Note.md",
    kind: "basic",
    fingerprint: `fp-${key}`,
    ordinal: 0,
    startOffset: 0,
    endOffset: 1,
    headingPath: [],
    status: "active",
    children: [],
    lastSeen: 1
  };
}

function conflict(code: string, path: string, overrides: Partial<SyncConflict> = {}): SyncConflict {
  return {
    key: `${code}-${path}`,
    code,
    severity: "error",
    message: `ENOENT: no such file or directory, open '${path}'`,
    path,
    createdAt: 1,
    lastSeenAt: 1,
    ...overrides
  };
}

describe("missing file detection", () => {
  it("recognizes Node filesystem errors", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory, open 'ToDo/Untitled 1.md'"), {
      code: "ENOENT"
    });
    expect(isMissingFileError(error)).toBe(true);
  });

  it("recognizes adapter errors that only carry a message", () => {
    expect(isMissingFileError(new Error("File does not exist."))).toBe(true);
    expect(isMissingFileError("no such file")).toBe(true);
  });

  it("does not mistake unrelated failures for a missing file", () => {
    expect(isMissingFileError(new Error("AnkiConnect refused the connection"))).toBe(false);
    expect(isMissingFileError(new Error("EACCES: permission denied"))).toBe(false);
  });
});

describe("vanished source notes", () => {
  it("forgets a vanished note that never held cards", () => {
    const files = [registryFile("f1", "ToDo/Untitled 1.md")];
    const forgotten = forgettableRegistryFiles(files, [], new Set<string>());
    expect(forgotten.map((file) => file.path)).toEqual(["ToDo/Untitled 1.md"]);
  });

  it("keeps reporting a vanished note whose cards are still in Anki", () => {
    const files = [registryFile("f1", "Biology.md")];
    const cards = [registryCard("c1", "f1")];
    expect(hasRegisteredCards(files[0]!, cards)).toBe(true);
    expect(forgettableRegistryFiles(files, cards, new Set<string>())).toEqual([]);
  });

  it("leaves notes alone that still exist in the vault", () => {
    const files = [registryFile("f1", "Present.md")];
    expect(forgettableRegistryFiles(files, [], new Set(["Present.md"]))).toEqual([]);
  });

  it("leaves confirmed Obsidian deletions to the deletion confirmation flow", () => {
    const files = [registryFile("f1", "Gone.md", { missingReason: "deleted-in-obsidian" })];
    expect(forgettableRegistryFiles(files, [], new Set<string>())).toEqual([]);
  });
});

describe("stale read failures", () => {
  it("selects unresolved read failures for notes without cards", () => {
    const conflicts = [
      conflict("SYNC_FAILED", "ToDo/Untitled 1.md"),
      conflict("SYNC_FAILED", "ToDo/Untitled 2.md")
    ];
    expect(prunableSyncFailures(conflicts, [], []).map((entry) => entry.path)).toEqual([
      "ToDo/Untitled 1.md",
      "ToDo/Untitled 2.md"
    ]);
  });

  it("keeps read failures for notes that still own cards", () => {
    const files = [registryFile("f1", "Biology.md")];
    const cards = [registryCard("c1", "f1")];
    const conflicts = [conflict("SYNC_FAILED", "Biology.md")];
    expect(prunableSyncFailures(conflicts, files, cards)).toEqual([]);
  });

  it("ignores already resolved entries and other conflict codes", () => {
    const conflicts = [
      conflict("SYNC_FAILED", "Resolved.md", { resolvedAt: 5 }),
      conflict("FILE_MISSING", "Moved.md"),
      conflict("ANKI_UNREACHABLE", "", { path: undefined })
    ];
    expect(prunableSyncFailures(conflicts, [], [])).toEqual([]);
  });
});
