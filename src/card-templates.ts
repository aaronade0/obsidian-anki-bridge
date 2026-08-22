import {
  BASIC_MARKER,
  CLOZE_CLOSE_MARKER,
  CLOZE_OPEN_MARKER,
  DUMP_END_MARKER,
  DUMP_START_MARKER,
  IMAGE_MARKER,
  LIST_END_MARKER,
  LIST_START_MARKER,
  REVERSE_MARKER
} from "./parser";

export type CardTemplateId = "basic" | "reverse" | "list" | "dump" | "image" | "cloze";

export interface CardTemplateChoice {
  id: CardTemplateId;
  name: string;
  description: string;
  icon: string;
  replacement: string;
  cursorBack: number;
}

export interface CardTemplateEditor {
  getSelection(): string;
  getCursor(side: "from"): { line: number; ch: number };
  posToOffset(position: { line: number; ch: number }): number;
  offsetToPos(offset: number): { line: number; ch: number };
  replaceSelection(replacement: string): void;
  setCursor(position: { line: number; ch: number }): void;
  focus(): void;
}

export const CARD_TEMPLATE_CHOICES: readonly CardTemplateChoice[] = [
  {
    id: "basic",
    name: "Basic card",
    description: "One question and one answer",
    icon: "arrow-right",
    replacement: BASIC_MARKER,
    cursorBack: 0
  },
  {
    id: "reverse",
    name: "Reversible card",
    description: "Creates cards in both directions",
    icon: "arrow-left-right",
    replacement: REVERSE_MARKER,
    cursorBack: 0
  },
  {
    id: "list",
    name: "List card",
    description: "One independently scheduled card per list item",
    icon: "list",
    replacement: `${LIST_START_MARKER}\n- \n${LIST_END_MARKER}`,
    cursorBack: LIST_END_MARKER.length + 1
  },
  {
    id: "dump",
    name: "Dump card",
    description: "A larger multi-line answer with rich content",
    icon: "align-left",
    replacement: `${DUMP_START_MARKER}\n\n${DUMP_END_MARKER}`,
    cursorBack: DUMP_END_MARKER.length + 1
  },
  {
    id: "image",
    name: "Image Occlusion card",
    description: "Uses Anki's native Image Occlusion note type",
    icon: "image",
    replacement: IMAGE_MARKER,
    cursorBack: 0
  },
  {
    id: "cloze",
    name: "Cloze deletion",
    description: "Wraps selected text or inserts an empty cloze",
    icon: "brackets",
    replacement: `${CLOZE_OPEN_MARKER}${CLOZE_CLOSE_MARKER}`,
    cursorBack: CLOZE_CLOSE_MARKER.length
  }
];

export function cardTemplateChoice(id: CardTemplateId): CardTemplateChoice {
  const choice = CARD_TEMPLATE_CHOICES.find((candidate) => candidate.id === id);
  if (!choice) {
    throw new Error(`Unknown card template: ${id}`);
  }
  return choice;
}

export function resolveCardTemplate(
  choice: CardTemplateChoice,
  selection: string
): { replacement: string; cursorBack: number } {
  if (choice.id === "cloze") {
    return {
      replacement: `${CLOZE_OPEN_MARKER}${selection}${CLOZE_CLOSE_MARKER}`,
      cursorBack: selection.length > 0 ? 0 : CLOZE_CLOSE_MARKER.length
    };
  }
  return {
    replacement: `${selection}${choice.replacement}`,
    cursorBack: choice.cursorBack
  };
}

export function insertCardTemplate(editor: CardTemplateEditor, choice: CardTemplateChoice): void {
  const startOffset = editor.posToOffset(editor.getCursor("from"));
  const resolved = resolveCardTemplate(choice, editor.getSelection());
  editor.replaceSelection(resolved.replacement);
  editor.setCursor(editor.offsetToPos(
    startOffset + resolved.replacement.length - resolved.cursorBack
  ));
  editor.focus();
}
