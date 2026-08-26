import { describe, expect, it } from "vitest";
import { findCanonicalEditorMarkerRanges } from "../src/editor-markers";
import { findCardTemplateShortcut } from "../src/editor-shortcuts";

describe("direct card template shortcuts", () => {
  it.each([
    [">>", "basic"],
    ["><", "reverse"],
    [">!", "image"],
    ["[", "cloze"]
  ] as const)("maps %s + Tab to %s", (trigger, id) => {
    const source = `Prompt ${trigger}`;
    expect(findCardTemplateShortcut(source, source.length)).toEqual({
      id,
      from: "Prompt ".length,
      to: source.length
    });
  });

  it.each([
    [">[]", "list"],
    [">{}", "dump"],
    ["[]", "cloze"]
  ] as const)("consumes an auto-added closer while the cursor is inside %s", (suffix, id) => {
    const source = `Prompt ${suffix}`;
    const head = source.length - 1;
    expect(findCardTemplateShortcut(source, head)).toEqual({
      id,
      from: "Prompt ".length,
      to: source.length
    });
  });

  it.each([
    [">[]", "list"],
    [">{}", "dump"],
    ["[]", "cloze"]
  ] as const)("consumes an auto-added closer when the cursor is after %s", (suffix, id) => {
    const source = `Prompt ${suffix}`;
    expect(findCardTemplateShortcut(source, source.length)).toEqual({
      id,
      from: "Prompt ".length,
      to: source.length
    });
  });

  it("does not hijack ordinary Tab presses", () => {
    expect(findCardTemplateShortcut("ordinary text", 13)).toBeUndefined();
  });
});

describe("atomic canonical editor markers", () => {
  it("keeps the visible bracket and its hidden comment in one cursor range", () => {
    const source = "Capital: ⟦%%oab:cloze:v1%%Berlin⟧%%oab:end:v1%%.";
    const ranges = findCanonicalEditorMarkerRanges(source);

    expect(ranges.map((range) => source.slice(range.atomicFrom, range.atomicTo))).toEqual([
      "⟦%%oab:cloze:v1%%",
      "⟧%%oab:end:v1%%"
    ]);
    expect(ranges[1]?.isEndMarker).toBe(true);
  });
});
