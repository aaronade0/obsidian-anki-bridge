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

  it("creates supported inline cards inside List items without leaking their answers into the outer List card", () => {
    const source = [
      "# Mechanics",
      "Name the concepts ⇢[%%oab:list:v1%%",
      "- Motion",
      "  - Velocity ⇢%%oab:basic:v1%%Change of position per time",
      "  - Momentum ⇄%%oab:reverse:v1%%Mass times velocity",
      "  - Energy is measured in ⟦%%oab:cloze:v1%%joules⟧%%oab:end:v1%%",
      "]⇠%%oab:end:v1%%"
    ].join("\n");
    const cards = parser.parse(source);

    expect(cards.map((card) => card.kind)).toEqual(["list", "basic", "reverse", "cloze"]);
    expect(cards[0]?.items[0]).toContain("Velocity");
    expect(cards[0]?.items[0]).not.toContain("Change of position per time");
    expect(cards[1]).toMatchObject({
      front: "Velocity",
      back: "Change of position per time",
      headingPath: ["Mechanics"],
      listContext: ["Motion"]
    });
    expect(cards[2]).toMatchObject({
      front: "Momentum",
      back: "Mass times velocity",
      listContext: ["Motion"]
    });
    expect(cards[3]).toMatchObject({
      front: "Energy is measured in {{c1::joules}}",
      listContext: ["Motion"]
    });
  });

  it("creates Cloze cards from top-level List items and continuation lines", () => {
    const source = [
      "Complete the statements ⇢[%%oab:list:v1%%",
      "- The capital is ⟦%%oab:cloze:v1%%Berlin⟧%%oab:end:v1%%.",
      "- Energy facts",
      "  Energy is measured in ⟦%%oab:cloze:v1%%joules⟧%%oab:end:v1%%.",
      "]⇠%%oab:end:v1%%"
    ].join("\n");
    const cards = parser.parse(source);

    expect(cards.map((card) => card.kind)).toEqual(["list", "cloze", "cloze"]);
    expect(cards[1]).toMatchObject({
      front: "The capital is {{c1::Berlin}}.",
      listContext: []
    });
    expect(cards[2]).toMatchObject({
      front: "Energy is measured in {{c1::joules}}.",
      listContext: ["Energy facts"]
    });
  });

  it("uses ancestor list items as context for ordinary indented cards", () => {
    const source = [
      "# Physics",
      "- Mechanics",
      "  1. Dynamics",
      "    - Force ⇢%%oab:basic:v1%%Mass times acceleration",
      "- Optics",
      "  - Refraction ⇢%%oab:basic:v1%%Change of direction"
    ].join("\n");
    const cards = parser.parse(source);

    expect(cards[0]).toMatchObject({ front: "Force", listContext: ["Mechanics", "Dynamics"] });
    expect(cards[1]).toMatchObject({ front: "Refraction", listContext: ["Optics"] });
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
