import { describe, expect, it } from "vitest";
import { FlashcardParser } from "../src/parser";
import { reconcileFile } from "../src/registry";
import type { RegistryCard, RegistryFile } from "../src/types";

const parser = new FlashcardParser();

describe("registry reconciliation", () => {
  it("keeps card IDs outside Markdown across edits", () => {
    const files: RegistryFile[] = [];
    const cards: RegistryCard[] = [];
    const firstSource = "Question ⇢%%oab:basic:v1%% Answer";
    const first = reconcileFile("Note.md", firstSource, parser.parse(firstSource), files, cards, 1);
    const key = first.activeCards[0]?.key;

    const editedSource = "Question ⇢%%oab:basic:v1%% Improved answer";
    const second = reconcileFile("Note.md", editedSource, parser.parse(editedSource), files, cards, 2);

    expect(second.activeCards[0]?.key).toBe(key);
    expect(second.activeCards[0]?.preview).toBe("Question");
    expect(editedSource.includes(key ?? "impossible")).toBe(false);
  });

  it("keeps list item note IDs through reordering", () => {
    const files: RegistryFile[] = [];
    const cards: RegistryCard[] = [];
    const firstSource = "Prompt ⇢[%%oab:list:v1%%\n- Alpha\n- Beta\n]⇠%%oab:end:v1%%";
    const first = reconcileFile("List.md", firstSource, parser.parse(firstSource), files, cards, 1);
    const alphaKey = first.activeCards[0]?.children.find((child) => child.ordinal === 0)?.key;

    const secondSource = "Prompt ⇢[%%oab:list:v1%%\n- Beta\n- Alpha\n]⇠%%oab:end:v1%%";
    const second = reconcileFile("List.md", secondSource, parser.parse(secondSource), files, cards, 2);
    expect(second.activeCards[0]?.children.find((child) => child.ordinal === 1)?.key).toBe(alphaKey);
    expect(second.activeCards[0]?.children.find((child) => child.ordinal === 1)?.preview).toBe("Alpha");
  });

  it("quarantines removed cards instead of deleting their records", () => {
    const files: RegistryFile[] = [];
    const cards: RegistryCard[] = [];
    const first = "One ⇢%%oab:basic:v1%% 1\nTwo ⇢%%oab:basic:v1%% 2";
    const second = "One ⇢%%oab:basic:v1%% 1";
    reconcileFile("Note.md", first, parser.parse(first), files, cards, 1);
    const result = reconcileFile("Note.md", second, parser.parse(second), files, cards, 2);

    expect(result.missingCards).toHaveLength(1);
    expect(result.missingCards[0]?.status).toBe("missing");
    expect(cards).toHaveLength(2);
  });

  it("retains a useful preview for removed list items", () => {
    const files: RegistryFile[] = [];
    const cards: RegistryCard[] = [];
    const first = "Prompt ⇢[%%oab:list:v1%%\n- Alpha\n- Beta\n]⇠%%oab:end:v1%%";
    const second = "Prompt ⇢[%%oab:list:v1%%\n- Alpha\n]⇠%%oab:end:v1%%";
    reconcileFile("List.md", first, parser.parse(first), files, cards, 1);
    const result = reconcileFile("List.md", second, parser.parse(second), files, cards, 2);

    const missing = result.activeCards[0]?.children.find((child) => child.status === "missing");
    expect(missing?.preview).toBe("Beta");
  });

  it("reactivates a quarantined card when it is restored before deletion", () => {
    const files: RegistryFile[] = [];
    const cards: RegistryCard[] = [];
    const source = "Question ⇢%%oab:basic:v1%%Answer";
    const first = reconcileFile("Note.md", source, parser.parse(source), files, cards, 1);
    const key = first.activeCards[0]?.key;
    reconcileFile("Note.md", "No cards", [], files, cards, 2);
    first.file.missingReason = "deleted-in-obsidian";
    const restored = reconcileFile("Note.md", source, parser.parse(source), files, cards, 3);

    expect(restored.activeCards[0]?.key).toBe(key);
    expect(restored.activeCards[0]?.status).toBe("active");
    expect(restored.missingCards).toEqual([]);
    expect(restored.file.missingReason).toBeUndefined();
  });
});
