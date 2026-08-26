import type { CardTemplateId } from "./card-templates";

export interface CardTemplateShortcut {
  id: CardTemplateId;
  from: number;
  to: number;
}

interface ShortcutSpec {
  id: CardTemplateId;
  trigger: string;
  autoCloser?: string;
}

const SHORTCUTS: readonly ShortcutSpec[] = [
  { id: "basic", trigger: ">>" },
  { id: "reverse", trigger: "><" },
  { id: "list", trigger: ">[", autoCloser: "]" },
  { id: "dump", trigger: ">{", autoCloser: "}" },
  { id: "image", trigger: ">!" },
  { id: "cloze", trigger: "[", autoCloser: "]" }
];

/**
 * Resolves a direct template shortcut around an empty cursor selection.
 * Obsidian may place the cursor either inside or after an automatically
 * inserted bracket pair, so both forms deliberately consume the closer.
 */
export function findCardTemplateShortcut(
  source: string,
  head: number
): CardTemplateShortcut | undefined {
  if (head < 0 || head > source.length) {
    return undefined;
  }

  for (const shortcut of SHORTCUTS) {
    const triggerFrom = head - shortcut.trigger.length;
    if (triggerFrom >= 0 && source.slice(triggerFrom, head) === shortcut.trigger) {
      const autoCloser = shortcut.autoCloser;
      const consumesCloser = autoCloser !== undefined &&
        source.slice(head, head + autoCloser.length) === autoCloser;
      return {
        id: shortcut.id,
        from: triggerFrom,
        to: head + (consumesCloser ? autoCloser?.length ?? 0 : 0)
      };
    }

    const autoCloser = shortcut.autoCloser;
    if (!autoCloser) {
      continue;
    }
    const paired = `${shortcut.trigger}${autoCloser}`;
    const pairFrom = head - paired.length;
    if (pairFrom >= 0 && source.slice(pairFrom, head) === paired) {
      return { id: shortcut.id, from: pairFrom, to: head };
    }
  }
  return undefined;
}
