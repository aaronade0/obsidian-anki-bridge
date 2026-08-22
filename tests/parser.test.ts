import { describe, expect, it } from "vitest";
import { FlashcardParser } from "../src/parser";

const parser = new FlashcardParser();

describe("FlashcardParser", () => {
  it("parses canonical inline cards and ignores legacy markers", () => {
    const cards = parser.parse([
      "Legacy >> must stay untouched",
      "Front ⇢%%oab:basic:v1%% Back #prio1",
      "Term ⇄%%oab:reverse:v1%% Definition #prio2",
      "Capital: ⟦%%oab:cloze:v1%%Berlin⟧%%oab:end:v1%% #prio3",
      "<!--ID: 123-->",
      "legacy #><# separator"
    ].join("\n"));

    expect(cards.map(({ kind }) => kind)).toEqual(["basic", "reverse", "cloze"]);
    expect(cards[0]).toMatchObject({ front: "Front", back: "Back", priority: 1 });
    expect(cards[1]).toMatchObject({ front: "Term", back: "Definition", priority: 2 });
    expect(cards[2]?.front).toBe("Capital: {{c1::Berlin}}");
  });

  it("creates independent top-level list items and retains nested content", () => {
    const source = [
      "# Mechanics",
      "## Newton",
      "Name the laws ⇢[%%oab:list:v1%% #prio1",
      "- Inertia",
      "  continued explanation",
      "  - nested example",
      "- Force equals mass times acceleration",
      "- Action and reaction",
      "]⇠%%oab:end:v1%%"
    ].join("\n");
    const [card] = parser.parse(source);

    expect(card).toMatchObject({
      kind: "list",
      front: "Name the laws",
      priority: 1,
      headingPath: ["Mechanics", "Newton"]
    });
    expect(card?.items).toHaveLength(3);
    expect(card?.items[0]).toContain("nested example");
  });

  it("allows fenced code in dump cards but does not parse markers inside ordinary fences", () => {
    const source = [
      "```ts",
      "const accidental = 'x ⇢%%oab:basic:v1%% y';",
      "```",
      "Explain the program ⇢{%%oab:dump:v1%%",
      "```ts",
      "const answer = 42;",
      "```",
      "}⇠%%oab:end:v1%%"
    ].join("\n");
    const cards = parser.parse(source);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "dump", front: "Explain the program" });
    expect(cards[0]?.back).toContain("const answer = 42;");
  });

  it("does not throw on unfinished block markers", () => {
    const result = parser.parse("Question ⇢[%%oab:list:v1%%\n- unfinished");
    expect(result).toEqual([]);
  });

  it("handles large list cards in one pass", () => {
    const items = Array.from({ length: 2_000 }, (_, index) => `- Item ${index + 1}`).join("\n");
    const [card] = parser.parse(`Large list ⇢[%%oab:list:v1%%\n${items}\n]⇠%%oab:end:v1%%`);
    expect(card?.items).toHaveLength(2_000);
    expect(card?.items[1_999]).toBe("Item 2000");
  });

  it("ignores visible arrows unless the versioned marker is present", () => {
    expect(parser.parse("Natural notation: A ⇢ B and C ⇄ D and ⟦text⟧")).toEqual([]);
  });
});
