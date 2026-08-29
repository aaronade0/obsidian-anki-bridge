import { describe, expect, it } from "vitest";
import { isSourcePathAllowed, parseFilterEntries } from "../src/source-filter";

const defaults = {
  excludedPaths: [] as string[],
  excludedFilenamePatterns: [] as string[],
  includedFolders: [] as string[]
};

describe("source path filters", () => {
  it("preserves the previous all-vault behavior by default", () => {
    expect(isSourcePathAllowed("Any/Note.md", defaults)).toBe(true);
    expect(isSourcePathAllowed("Root note.md", defaults)).toBe(true);
  });

  it("excludes exact paths, folders, and their descendants", () => {
    const settings = { ...defaults, excludedPaths: ["Archive", "Exact.md"] };
    expect(isSourcePathAllowed("Archive/Old.md", settings)).toBe(false);
    expect(isSourcePathAllowed("archive/Nested/Old.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Exact.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Archive copy/Old.md", settings)).toBe(true);
  });

  it("supports wildcard path exclusions", () => {
    const settings = { ...defaults, excludedPaths: ["Templates/*.md", "Private/??.md"] };
    expect(isSourcePathAllowed("Templates/Card.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Templates/Nested/Card.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Private/AB.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Private/ABC.md", settings)).toBe(true);
  });

  it("matches plain filename text anywhere and accepts filename globs", () => {
    const settings = {
      ...defaults,
      excludedFilenamePatterns: ["draft", "_temp*", "*.canvas.md"]
    };
    expect(isSourcePathAllowed("Notes/My Draft 2.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Notes/_TEMP-import.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Notes/map.canvas.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Notes/Final.md", settings)).toBe(true);
  });

  it("uses included folders as an optional allowlist", () => {
    const settings = { ...defaults, includedFolders: ["University/Physics", "Inbox"] };
    expect(isSourcePathAllowed("University/Physics/Mechanics.md", settings)).toBe(true);
    expect(isSourcePathAllowed("University/Physics/Labs/One.md", settings)).toBe(true);
    expect(isSourcePathAllowed("Inbox/Capture.md", settings)).toBe(true);
    expect(isSourcePathAllowed("University/Math/Analysis.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Root.md", settings)).toBe(false);
  });

  it("gives exclusions precedence over the folder allowlist", () => {
    const settings = {
      ...defaults,
      includedFolders: ["Study"],
      excludedPaths: ["Study/Archive"],
      excludedFilenamePatterns: ["solution"]
    };
    expect(isSourcePathAllowed("Study/Chapter.md", settings)).toBe(true);
    expect(isSourcePathAllowed("Study/Archive/Old.md", settings)).toBe(false);
    expect(isSourcePathAllowed("Study/Solution 1.md", settings)).toBe(false);
  });

  it("normalizes multiline setting input", () => {
    expect(parseFilterEntries("  First  \n\nSecond\r\n  ")).toEqual(["First", "Second"]);
  });
});
