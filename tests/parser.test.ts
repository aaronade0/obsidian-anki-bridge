import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";
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

  it("numbers multiple Cloze deletions on one line independently", () => {
    const [card] = parser.parse(
      "Velocity is ⟦%%oab:cloze:v1%%distance⟧%%oab:end:v1%% divided by ⟦%%oab:cloze:v1%%time⟧%%oab:end:v1%%."
    );

    expect(card).toMatchObject({
      kind: "cloze",
      front: "Velocity is {{c1::distance}} divided by {{c2::time}}."
    });
  });

  it("keeps the full Markdown table visible while independently testing each marked row", () => {
    const source = [
      "| Quantity | Symbol | Unit |",
      "| --- | --- | --- |",
      "| Velocity | ⟦%%oab:cloze:v1%%v⟧%%oab:end:v1%% | ⟦%%oab:cloze:v1%%m/s⟧%%oab:end:v1%% |",
      "| Acceleration | ⟦%%oab:cloze:v1%%a⟧%%oab:end:v1%% | ⟦%%oab:cloze:v1%%m/s²⟧%%oab:end:v1%% |"
    ].join("\n");
    const cards = parser.parse(source);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ kind: "cloze", startLine: 2, endLine: 2 });
    expect(cards[1]).toMatchObject({ kind: "cloze", startLine: 3, endLine: 3 });
    expect(source.slice(cards[0]?.ranges.marker.from, cards[0]?.ranges.marker.to)).toBe("⟦%%oab:cloze:v1%%");
    expect(cards[0]?.front).toContain("| Velocity | {{c1::v}} | {{c2::m/s}} |");
    expect(cards[0]?.front).toContain("| Acceleration | a | m/s² |");
    expect(cards[1]?.front).toContain("| Velocity | v | m/s |");
    expect(cards[1]?.front).toContain("| Acceleration | {{c1::a}} | {{c2::m/s²}} |");
    const rendered = new MarkdownIt().render(cards[0]?.front ?? "");
    expect(rendered).toContain("<table>");
    expect(rendered).toContain("<td>{{c1::v}}</td>");
    expect(rendered).toContain("<td>{{c2::m/s}}</td>");
  });

  it("keeps nested TeX braces from prematurely closing an Anki cloze", () => {
    const source = [
      "| Energieform | Formel |",
      "| --- | --- |",
      "| gravitativ | ⟦%%oab:cloze:v1%%$E=\\frac{g^{2}}{8 \\pi G}$⟧%%oab:end:v1%% |"
    ].join("\n");

    const [card] = parser.parse(source);

    expect(card?.front).toContain("{{c1::$E=\\frac{g^{2} }{8 \\pi G}$}}");
    expect(card?.front.match(/}}/g)).toHaveLength(1);
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
