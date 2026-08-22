import type { Extension } from "@codemirror/state";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { FuzzySuggestModal, type App } from "obsidian";
import {
  BASIC_MARKER,
  CLOZE_CLOSE_MARKER,
  CLOZE_OPEN_MARKER,
  DUMP_END_MARKER,
  DUMP_START_MARKER,
  FlashcardParser,
  IMAGE_MARKER,
  LIST_END_MARKER,
  LIST_START_MARKER,
  REVERSE_MARKER
} from "./parser";

interface TemplateChoice {
  name: string;
  replacement: string;
  cursorBack: number;
}

const choices: TemplateChoice[] = [
  { name: "Basic card (one direction)", replacement: BASIC_MARKER, cursorBack: 0 },
  { name: "Reversible card", replacement: REVERSE_MARKER, cursorBack: 0 },
  { name: "List Card", replacement: `${LIST_START_MARKER}\n- \n${LIST_END_MARKER}`, cursorBack: LIST_END_MARKER.length + 1 },
  { name: "Dump Card", replacement: `${DUMP_START_MARKER}\n\n${DUMP_END_MARKER}`, cursorBack: DUMP_END_MARKER.length + 1 },
  { name: "Image card", replacement: IMAGE_MARKER, cursorBack: 0 },
  { name: "Cloze deletion", replacement: `${CLOZE_OPEN_MARKER}${CLOZE_CLOSE_MARKER}`, cursorBack: CLOZE_CLOSE_MARKER.length }
];

export function createEditorExtensions(app: App, parser: FlashcardParser): Extension[] {
  const decorations = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, parser);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, parser);
        }
      }
    },
    { decorations: (instance) => instance.decorations }
  );

  const templateKeymap = keymap.of([
    {
      key: "Tab",
      run(view): boolean {
        const selection = view.state.selection.main;
        if (!selection.empty) {
          return false;
        }
        const head = selection.head;
        if (head >= 2 && view.state.doc.sliceString(head - 2, head) === ">>") {
          const inserted = BASIC_MARKER;
          view.dispatch({
            changes: { from: head - 2, to: head, insert: inserted },
            selection: { anchor: head - 2 + inserted.length }
          });
          return true;
        }
        if (head >= 1 && view.state.doc.sliceString(head - 1, head) === ">") {
          new CardTypeModal(app, (choice) => {
            const currentHead = view.state.selection.main.head;
            const from = currentHead > 0 && view.state.doc.sliceString(currentHead - 1, currentHead) === ">"
              ? currentHead - 1
              : currentHead;
            const finalHead = from + choice.replacement.length - choice.cursorBack;
            view.dispatch({
              changes: { from, to: currentHead, insert: choice.replacement },
              selection: { anchor: finalHead },
              scrollIntoView: true
            });
            view.focus();
          }).open();
          return true;
        }
        return false;
      }
    }
  ]);

  return [decorations, Prec.highest(templateKeymap)];
}

class CardTypeModal extends FuzzySuggestModal<TemplateChoice> {
  constructor(
    app: App,
    private readonly onChoose: (choice: TemplateChoice) => void
  ) {
    super(app);
    this.setPlaceholder("Choose a card format …");
  }

  getItems(): TemplateChoice[] {
    return choices;
  }

  getItemText(item: TemplateChoice): string {
    return item.name;
  }

  onChooseItem(item: TemplateChoice): void {
    this.onChoose(item);
  }
}

function buildDecorations(view: EditorView, parser: FlashcardParser): DecorationSet {
  const source = view.state.doc.toString();
  const parsed = parser.parse(source);
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  for (const card of parsed) {
    addMark(ranges, card.ranges.front.from, card.ranges.front.to, "oab-card-field oab-card-front");
    if (card.ranges.back && (card.ranges.items?.length ?? 0) === 0) {
      addMark(ranges, card.ranges.back.from, card.ranges.back.to, "oab-card-field oab-card-back");
    }
    for (const item of card.ranges.items ?? []) {
      addMark(ranges, item.from, item.to, "oab-card-field oab-card-list-item");
    }
    const visibleLength = card.kind === "basic" || card.kind === "reverse" || card.kind === "cloze" ? 1 : 2;
    addMark(
      ranges,
      card.ranges.marker.from,
      Math.min(card.ranges.marker.from + visibleLength, card.ranges.marker.to),
      "oab-card-marker"
    );
  }
  for (const match of source.matchAll(/%%oab:(?:basic|reverse|list|dump|image|cloze|end):v1%%/g)) {
    const from = match.index;
    const to = from + match[0].length;
    ranges.push({ from, to, decoration: Decoration.replace({}) });
    if (source.slice(Math.max(0, from - 2), from) === "]⇠" || source.slice(Math.max(0, from - 2), from) === "}⇠") {
      addMark(ranges, from - 2, from, "oab-card-marker oab-card-end-marker");
    } else if (source.slice(Math.max(0, from - 1), from) === "⟧") {
      addMark(ranges, from - 1, from, "oab-card-marker oab-card-end-marker");
    }
  }
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, range.decoration);
  }
  return builder.finish();
}

function addMark(
  target: Array<{ from: number; to: number; decoration: Decoration }>,
  from: number,
  to: number,
  className: string
): void {
  if (to > from) {
    target.push({ from, to, decoration: Decoration.mark({ class: className }) });
  }
}
