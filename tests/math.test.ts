import { describe, expect, it } from "vitest";
import { mathJaxForAnki, replaceObsidianMath } from "../src/math";

const convert = (value: string): string => replaceObsidianMath(
  value,
  ({ display, tex }) => display ? `\\[${tex}\\]` : `\\(${tex}\\)`
);

describe("Obsidian math conversion", () => {
  it("converts Obsidian inline and display math to Anki MathJax delimiters", () => {
    expect(convert("Energy: $E=mc^2$\n\n$$F=ma$$")).toBe("Energy: \\(E=mc^2\\)\n\n\\[F=ma\\]");
  });

  it("leaves escaped dollars, currency, and inline code unchanged", () => {
    expect(convert("Cost: $5 and $10; `literal $x$`; escaped \\$x\\$")).toBe(
      "Cost: $5 and $10; `literal $x$`; escaped \\$x\\$"
    );
  });

  it("uses Anki MathJax delimiters and HTML-escapes formula content", () => {
    expect(mathJaxForAnki({ display: false, tex: "x < y & y > 0" })).toBe(
      "\\(x &lt; y &amp; y &gt; 0\\)"
    );
  });
});
