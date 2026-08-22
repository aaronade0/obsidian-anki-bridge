import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FlashcardParser } from "../src/parser";

describe("parser robustness", () => {
  it("never throws for arbitrary Markdown-sized text", () => {
    const parser = new FlashcardParser();
    fc.assert(
      fc.property(fc.string({ maxLength: 4_000 }), (source) => {
        const result = parser.parse(source);
        expect(Array.isArray(result)).toBe(true);
      }),
      { numRuns: 250 }
    );
  });

  it("never interprets legacy Front >> Back lines", () => {
    const parser = new FlashcardParser();
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), fc.string({ maxLength: 80 }), (front, back) => {
        expect(parser.parse(`${front} >> ${back}`)).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
