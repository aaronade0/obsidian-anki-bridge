import type { Extension } from "@codemirror/state";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  FuzzySuggestModal,
  Platform,
  setIcon,
  type App,
  type Editor,
  type FuzzyMatch
} from "obsidian";
import {
  CARD_TEMPLATE_CHOICES,
  cardTemplateChoice,
  insertCardTemplate,
  resolveCardTemplate,
  type CardTemplateChoice
} from "./card-templates";
import { FlashcardParser } from "./parser";
import { findTypedDoubleChevronTrigger } from "./mobile-editor-trigger";

export function openCardTypeModal(app: App, editor: Editor): void {
  new CardTypeModal(app, (choice) => insertCardTemplate(editor, choice)).open();
}

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
          const inserted = resolveCardTemplate(cardTemplateChoice("basic"), "").replacement;
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
            const resolved = resolveCardTemplate(choice, "");
            const finalHead = from + resolved.replacement.length - resolved.cursorBack;
            view.dispatch({
              changes: { from, to: currentHead, insert: resolved.replacement },
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

  const mobileTemplateTrigger = ViewPlugin.fromClass(
    class {
      private pickerOpen = false;

      update(update: ViewUpdate): void {
        if (!Platform.isMobile || this.pickerOpen) {
          return;
        }
        const trigger = findTypedDoubleChevronTrigger(update);
        if (!trigger) {
          return;
        }

        this.pickerOpen = true;
        new CardTypeModal(
          app,
          (choice) => replaceTriggerWithTemplate(update.view, trigger, choice),
          () => {
            this.pickerOpen = false;
          }
        ).open();
      }
    }
  );

  return [decorations, mobileTemplateTrigger, Prec.highest(templateKeymap)];
}

function replaceTriggerWithTemplate(
  view: EditorView,
  trigger: { from: number; to: number },
  choice: CardTemplateChoice
): void {
  if (view.state.doc.sliceString(trigger.from, trigger.to) !== ">>") {
    return;
  }
  const resolved = resolveCardTemplate(choice, "");
  const finalHead = trigger.from + resolved.replacement.length - resolved.cursorBack;
  view.dispatch({
    changes: { from: trigger.from, to: trigger.to, insert: resolved.replacement },
    selection: { anchor: finalHead },
    scrollIntoView: true
  });
  view.focus();
}

class CardTypeModal extends FuzzySuggestModal<CardTemplateChoice> {
  constructor(
    app: App,
    private readonly onChoose: (choice: CardTemplateChoice) => void,
    private readonly onDidClose?: () => void
  ) {
    super(app);
    this.setPlaceholder("Choose a card format …");
    this.modalEl.addClass("oab-card-picker");
  }

  getItems(): CardTemplateChoice[] {
    return [...CARD_TEMPLATE_CHOICES];
  }

  getItemText(item: CardTemplateChoice): string {
    return item.name;
  }

  renderSuggestion(match: FuzzyMatch<CardTemplateChoice>, element: HTMLElement): void {
    const row = element.createDiv({ cls: "oab-card-picker-row" });
    const icon = row.createSpan({ cls: "oab-card-picker-icon" });
    setIcon(icon, match.item.icon);
    const text = row.createDiv({ cls: "oab-card-picker-text" });
    text.createDiv({ cls: "oab-card-picker-name", text: match.item.name });
    text.createDiv({ cls: "oab-card-picker-description", text: match.item.description });
  }

  onChooseItem(item: CardTemplateChoice): void {
    this.onChoose(item);
  }

  onClose(): void {
    this.onDidClose?.();
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
