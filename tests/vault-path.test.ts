import { describe, expect, it } from "vitest";
import { normalizeMarkdownPath } from "../src/vault-path";

describe("vault Markdown path input", () => {
  it("accepts vault-relative paths and adds the Markdown extension", () => {
    expect(normalizeMarkdownPath(" ToDo/todos/Moved note ")).toBe("ToDo/todos/Moved note.md");
    expect(normalizeMarkdownPath("[[Archive/Moved note.md]]")).toBe("Archive/Moved note.md");
  });

  it.each([
    "",
    "/absolute.md",
    "../outside.md",
    "Folder/../outside.md",
    "Folder\\Note.md",
    "Folder//Note.md",
    "[[Note#Heading]]",
    "[[Note|Alias]]"
  ])("rejects unsafe or ambiguous input: %s", (path) => {
    expect(() => normalizeMarkdownPath(path)).toThrow();
  });
});
