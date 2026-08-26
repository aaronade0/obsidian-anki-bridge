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
import { findCardTemplateShortcut } from "./editor-shortcuts";
import { findCanonicalEditorMarkerRanges } from "./editor-markers";

export function openCardTypeModal(app: App, editor: Editor): void {
  new CardTypeModal(app, (choice) => insertCardTemplate(editor, choice)).open();
}

export interface EditorCardActions {
  openCard(ordinal: number): void;
}

export function createEditorExtensions(
  app: App,
  parser: FlashcardParser,
  cardActions: EditorCardActions
): Extension[] {
  const decorations = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomicRanges: DecorationSet;

      constructor(view: EditorView) {
        const built = buildDecorations(view, parser);
        this.decorations = built.decorations;
        this.atomicRanges = built.atomicRanges;
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          const built = buildDecorations(update.view, parser);
          this.decorations = built.decorations;
          this.atomicRanges = built.atomicRanges;
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
      provide: (plugin) => EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none
      )
    }
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
        const shortcut = findCardTemplateShortcut(view.state.doc.toString(), head);
        if (shortcut) {
          const resolved = resolveCardTemplate(cardTemplateChoice(shortcut.id), "");
          const finalHead = shortcut.from + resolved.replacement.length - resolved.cursorBack;
          view.dispatch({
            changes: { from: shortcut.from, to: shortcut.to, insert: resolved.replacement },
            selection: { anchor: finalHead },
            scrollIntoView: true
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

  const clickableMarkers = EditorView.domEventHandlers({
    click(event): boolean {
      const ordinal = markerOrdinal(event.target);
      if (ordinal === undefined) {
        return false;
      }
      event.preventDefault();
      cardActions.openCard(ordinal);
      return true;
    },
    keydown(event): boolean {
      if (event.key !== "Enter" && event.key !== " ") {
        return false;
      }
      const ordinal = markerOrdinal(event.target);
      if (ordinal === undefined) {
        return false;
      }
      event.preventDefault();
      cardActions.openCard(ordinal);
      return true;
    }
  });

  return [decorations, clickableMarkers, mobileTemplateTrigger, Prec.highest(templateKeymap)];
}

function markerOrdinal(target: EventTarget | null): number | undefined {
  const element = target instanceof Element ? target.closest<HTMLElement>(".oab-card-marker[data-oab-card-ordinal]") : null;
  const raw = element?.dataset.oabCardOrdinal;
  if (raw === undefined) {
    return undefined;
  }
  const ordinal = Number.parseInt(raw, 10);
  return Number.isSafeInteger(ordinal) && ordinal >= 0 ? ordinal : undefined;
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

function buildDecorations(
  view: EditorView,
  parser: FlashcardParser
): { decorations: DecorationSet; atomicRanges: DecorationSet } {
  const source = view.state.doc.toString();
  const parsed = parser.parse(source);
  const ranges: Array<{ from: number; to: number; decoration: Decoration }> = [];
  const atomicRanges: Array<{ from: number; to: number; decoration: Decoration }> = [];
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
      "oab-card-marker",
      {
        "data-oab-card-ordinal": String(card.ordinal),
        "aria-label": "Open this card in Anki",
        role: "button",
        tabindex: "0"
      }
    );
  }
  for (const marker of findCanonicalEditorMarkerRanges(source)) {
    ranges.push({
      from: marker.hiddenFrom,
      to: marker.hiddenTo,
      decoration: Decoration.replace({})
    });
    atomicRanges.push({
      from: marker.atomicFrom,
      to: marker.atomicTo,
      decoration: Decoration.mark({})
    });
    if (marker.isEndMarker) {
      addMark(
        ranges,
        marker.visibleFrom,
        marker.visibleTo,
        "oab-card-marker oab-card-end-marker"
      );
    }
  }
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, range.decoration);
  }
  atomicRanges.sort((left, right) => left.from - right.from || left.to - right.to);
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  for (const range of atomicRanges) {
    atomicBuilder.add(range.from, range.to, range.decoration);
  }
  return { decorations: builder.finish(), atomicRanges: atomicBuilder.finish() };
}

function addMark(
  target: Array<{ from: number; to: number; decoration: Decoration }>,
  from: number,
  to: number,
  className: string,
  attributes?: Record<string, string>
): void {
  if (to > from) {
    target.push({ from, to, decoration: Decoration.mark({ class: className, attributes }) });
  }
}
