import { describe, expect, it } from "vitest";
import {
  cardTemplateChoice,
  insertCardTemplate,
  type CardTemplateEditor
} from "../src/card-templates";
import { FlashcardParser } from "../src/parser";

class MemoryEditor implements CardTemplateEditor {
  focused = false;

  constructor(
    private value: string,
    private selectionFrom: number,
    private selectionTo = selectionFrom
  ) {}

  getSelection(): string {
    return this.value.slice(this.selectionFrom, this.selectionTo);
  }

  getCursor(side: "from"): { line: number; ch: number } {
    return this.offsetToPos(side === "from" ? this.selectionFrom : this.selectionTo);
  }

  posToOffset(position: { line: number; ch: number }): number {
    const lines = this.value.split("\n");
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) {
      offset += (lines[line]?.length ?? 0) + 1;
    }
    return offset + position.ch;
  }

  offsetToPos(offset: number): { line: number; ch: number } {
    const before = this.value.slice(0, offset).split("\n");
    return { line: before.length - 1, ch: before.at(-1)?.length ?? 0 };
  }

  replaceSelection(replacement: string): void {
    this.value = this.value.slice(0, this.selectionFrom) + replacement + this.value.slice(this.selectionTo);
    this.selectionTo = this.selectionFrom + replacement.length;
    this.selectionFrom = this.selectionTo;
  }

  setCursor(position: { line: number; ch: number }): void {
    const offset = this.posToOffset(position);
    this.selectionFrom = offset;
    this.selectionTo = offset;
  }

  focus(): void {
    this.focused = true;
  }

  snapshot(): { value: string; cursor: number; focused: boolean } {
    return { value: this.value, cursor: this.selectionFrom, focused: this.focused };
  }
}

describe("mobile card template insertion", () => {
  it("inserts a basic marker at the cursor without adding whitespace", () => {
    const editor = new MemoryEditor("Question ", 9);
    insertCardTemplate(editor, cardTemplateChoice("basic"));

    expect(editor.snapshot()).toEqual({
      value: "Question ⇢%%oab:basic:v1%%",
      cursor: "Question ⇢%%oab:basic:v1%%".length,
      focused: true
    });
  });

  it("uses selected text as the front and places the cursor inside a dump card", () => {
    const editor = new MemoryEditor("Explain motion", 0, "Explain motion".length);
    insertCardTemplate(editor, cardTemplateChoice("dump"));
    const snapshot = editor.snapshot();

    expect(snapshot.value).toBe(
      "Explain motion⇢{%%oab:dump:v1%%\n\n}⇠%%oab:end:v1%%"
    );
    expect(snapshot.cursor).toBe(snapshot.value.indexOf("\n\n") + 1);
  });

  it("wraps selected text as a valid cloze deletion", () => {
    const editor = new MemoryEditor("Capital: Berlin", 9, 15);
    insertCardTemplate(editor, cardTemplateChoice("cloze"));
    const snapshot = editor.snapshot();
    const [card] = new FlashcardParser().parse(snapshot.value);

    expect(card?.kind).toBe("cloze");
    expect(card?.front).toBe("Capital: {{c1::Berlin}}");
    expect(snapshot.cursor).toBe(snapshot.value.length);
  });
});
