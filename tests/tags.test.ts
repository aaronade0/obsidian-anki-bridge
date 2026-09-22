import { describe, expect, it } from "vitest";
import { FlashcardParser } from "../src/parser";
import { collectTags, isOnlyTags, stripTrailingTags, toAnkiTags } from "../src/tags";

describe("tag scanning", () => {
  it("accepts Obsidian tags and rejects headings, numbers and code", () => {
    expect(collectTags("#### [[Sinus]] #prio3")).toEqual(["prio3"]);
    expect(collectTags("\\newcommand{\\x}[1]{#1}")).toEqual([]);
    expect(collectTags("`#prio1` stays documentation")).toEqual([]);
    expect(collectTags("Nested #schule/mathe and #wichtig!")).toEqual(["schule/mathe", "wichtig"]);
  });

  it("separates trailing tags from content", () => {
    expect(stripTrailingTags("Back #prio3 #wichtig")).toEqual({
      value: "Back",
      tags: ["prio3", "wichtig"]
    });
    expect(stripTrailingTags("Back")).toEqual({ value: "Back", tags: [] });
    expect(isOnlyTags("  #prio3  ")).toBe(true);
    expect(isOnlyTags("Quelle: https://example.org")).toBe(false);
  });

  it("maps Obsidian nesting onto Anki nesting", () => {
    expect(toAnkiTags(["schule/mathe", "prio3", "prio3"])).toEqual(["schule::mathe", "prio3"]);
  });
});

describe("FlashcardParser tag placement", () => {
  const parser = new FlashcardParser();

  it("takes tags before the opening marker of a block card", () => {
    const [card] = parser.parse([
      "#### [[Sinus]] #prio3 ⇢{%%oab:dump:v1%%",
      "![[Sketch.png]]",
      "}⇠%%oab:end:v1%%"
    ].join("\n"));

    expect(card?.kind).toBe("dump");
    expect(card?.tags).toEqual(["prio3"]);
    expect(card?.front).toBe("#### [[Sinus]]");
  });

  it("takes tags from a line inside a block card and keeps them out of the body", () => {
    const [card] = parser.parse([
      "[[Cosinus]] ⇢{%%oab:dump:v1%%",
      "![[Sketch.png]]",
      "#prio3",
      "Quelle: https://example.org",
      "}⇠%%oab:end:v1%%"
    ].join("\n"));

    expect(card?.tags).toEqual(["prio3"]);
    expect(card?.back).toBe("![[Sketch.png]]\nQuelle: https://example.org");
  });

  it("takes tags written after the closing marker", () => {
    const [card] = parser.parse([
      "[[Tangens]] ⇢{%%oab:dump:v1%%",
      "![[Sketch.png]]",
      "}⇠%%oab:end:v1%% #prio3 #herleitung"
    ].join("\n"));

    expect(card?.tags).toEqual(["prio3", "herleitung"]);
  });

  it("collects every tag of an inline card and strips only the trailing ones", () => {
    const [card] = parser.parse("#wichtig Front ⇢%%oab:basic:v1%% Back #prio2");

    expect(card?.tags).toEqual(["wichtig", "prio2"]);
    expect(card?.back).toBe("Back");
  });

  it("gives each list item its own tags next to the block tags", () => {
    const [card] = parser.parse([
      "Laws ⇢[%%oab:list:v1%% #prio1",
      "- Inertia #leicht",
      "- Force #schwer",
      "]⇠%%oab:end:v1%%"
    ].join("\n"));

    expect(card?.tags).toEqual(["prio1"]);
    expect(card?.itemTags).toEqual([["leicht"], ["schwer"]]);
    expect(card?.items).toEqual(["Inertia", "Force"]);
  });

  it("still rejects a block marker followed by content", () => {
    expect(parser.parse([
      "Front ⇢{%%oab:dump:v1%% stray text",
      "body",
      "}⇠%%oab:end:v1%%"
    ].join("\n"))).toEqual([]);
  });
});
