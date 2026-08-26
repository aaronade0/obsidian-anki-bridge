import { normalizeForFingerprint, stableHash } from "./hash";
import type { CardKind, ParsedCard, Priority, TextRange } from "./types";

interface SourceLine {
  number: number;
  from: number;
  to: number;
  text: string;
}

interface PriorityResult {
  value: string;
  priority?: Priority;
}

interface CardLineContent {
  text: string;
  from: number;
  isListItem: boolean;
}

const PRIORITY_PATTERN = /(?:^|\s)#prio([1-4])\s*$/i;
export const BASIC_MARKER = "⇢%%oab:basic:v1%%";
export const REVERSE_MARKER = "⇄%%oab:reverse:v1%%";
export const LIST_START_MARKER = "⇢[%%oab:list:v1%%";
export const LIST_END_MARKER = "]⇠%%oab:end:v1%%";
export const DUMP_START_MARKER = "⇢{%%oab:dump:v1%%";
export const DUMP_END_MARKER = "}⇠%%oab:end:v1%%";
export const IMAGE_MARKER = "⇢▣%%oab:image:v1%%";
export const CLOZE_OPEN_MARKER = "⟦%%oab:cloze:v1%%";
export const CLOZE_CLOSE_MARKER = "⟧%%oab:end:v1%%";

const LIST_START_PATTERN = /^(.*?)\s*⇢\[%%oab:list:v1%%\s*(?:#prio([1-4]))?\s*$/i;
const DUMP_START_PATTERN = /^(.*?)\s*⇢\{%%oab:dump:v1%%\s*(?:#prio([1-4]))?\s*$/i;
const IMAGE_PATTERN = /^(.*?)\s*⇢▣%%oab:image:v1%%\s*(.*?)\s*(?:#prio([1-4]))?\s*$/i;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/;

export class FlashcardParser {
  parse(source: string): ParsedCard[] {
    if (!source.includes("%%oab:")) {
      return [];
    }

    const lines = toSourceLines(source);
    const cards: ParsedCard[] = [];
    const headings: string[] = [];
    const listContexts = collectListContexts(lines);
    let fence: string | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) {
        continue;
      }

      const fenceMatch = line.text.match(FENCE_PATTERN);
      if (fenceMatch) {
        const marker = fenceMatch[1]?.[0];
        if (fence === null) {
          fence = marker ?? null;
        } else if (fence === marker) {
          fence = null;
        }
        continue;
      }
      if (fence !== null) {
        continue;
      }

      updateHeadingPath(headings, line.text);

      const cardLine = cardLineContent(line);

      const listStart = cardLine.text.match(LIST_START_PATTERN);
      if (listStart) {
        const endIndex = findBlockEnd(lines, index + 1, LIST_END_MARKER);
        if (endIndex !== -1) {
          const front = listStart[1]?.trim() ?? "";
          const blockLines = lines.slice(index + 1, endIndex);
          const itemResult = parseListItems(blockLines);
          const closingPriority = stripPriority(lines[endIndex]?.text.replace(LIST_END_MARKER, "") ?? "").priority;
          const priority = parsePriority(listStart[2]) ?? closingPriority;
          cards.push(
            makeCard({
              ordinal: cards.length,
              kind: "list",
              front,
              back: "",
              items: itemResult.items,
              priority,
              headings,
              listContext: listContexts.get(line.number) ?? [],
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, LIST_START_MARKER),
              frontRange: {
                from: cardLine.from,
                to: cardLine.from + Math.max(0, cardLine.text.indexOf(LIST_START_MARKER))
              },
              backRange: blockRange(blockLines),
              itemRanges: itemResult.ranges
            })
          );
          cards.push(...parseNestedInlineListCards(
            blockLines,
            cards.length,
            headings,
            listContexts
          ));
          index = endIndex;
        }
        // An unfinished structured block is invalid, not a one-line basic card.
        continue;
      }

      const dumpStart = cardLine.text.match(DUMP_START_PATTERN);
      if (dumpStart) {
        const endIndex = findBlockEnd(lines, index + 1, DUMP_END_MARKER);
        if (endIndex !== -1) {
          const bodyLines = lines.slice(index + 1, endIndex);
          const closingPriority = stripPriority(lines[endIndex]?.text.replace(DUMP_END_MARKER, "") ?? "").priority;
          const priority = parsePriority(dumpStart[2]) ?? closingPriority;
          cards.push(
            makeCard({
              ordinal: cards.length,
              kind: "dump",
              front: dumpStart[1]?.trim() ?? "",
              back: bodyLines.map((bodyLine) => bodyLine.text).join("\n").trim(),
              items: [],
              priority,
              headings,
              listContext: listContexts.get(line.number) ?? [],
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, DUMP_START_MARKER),
              frontRange: {
                from: cardLine.from,
                to: cardLine.from + Math.max(0, cardLine.text.indexOf(DUMP_START_MARKER))
              },
              backRange: blockRange(bodyLines)
            })
          );
          index = endIndex;
        }
        continue;
      }

      const inline = parseInlineCard(
        line,
        cardLine,
        cards.length,
        headings,
        listContexts.get(line.number) ?? []
      );
      if (inline) {
        cards.push(inline);
      }
    }

    return cards;
  }
}

interface MakeCardInput {
  ordinal: number;
  kind: CardKind;
  front: string;
  back: string;
  items: string[];
  priority?: Priority;
  headings: string[];
  listContext: string[];
  start: SourceLine;
  end: SourceLine;
  marker: TextRange;
  frontRange: TextRange;
  backRange?: TextRange;
  itemRanges?: TextRange[];
}

function makeCard(input: MakeCardInput): ParsedCard {
  const normalized = [
    input.kind,
    normalizeForFingerprint(input.front),
    normalizeForFingerprint(input.back),
    ...input.items.map(normalizeForFingerprint)
  ].join("\u241f");
  return {
    ordinal: input.ordinal,
    kind: input.kind,
    front: input.front,
    back: input.back,
    items: input.items,
    priority: input.priority,
    headingPath: [...input.headings],
    listContext: [...input.listContext],
    fingerprint: stableHash(normalized),
    startLine: input.start.number,
    endLine: input.end.number,
    ranges: {
      whole: { from: input.start.from, to: input.end.to },
      marker: input.marker,
      front: input.frontRange,
      back: input.backRange,
      items: input.itemRanges
    }
  };
}

function inlineCard(
  ordinal: number,
  kind: CardKind,
  line: SourceLine,
  marker: string,
  front: string,
  back: string,
  priority: Priority | undefined,
  headings: string[],
  listContext: string[],
  content: CardLineContent
): ParsedCard {
  const markerIndex = content.text.indexOf(marker);
  const priorityIndex = content.text.search(PRIORITY_PATTERN);
  return makeCard({
    ordinal,
    kind,
    front,
    back,
    items: [],
    priority,
    headings,
    listContext,
    start: line,
    end: line,
    marker: { from: content.from + markerIndex, to: content.from + markerIndex + marker.length },
    frontRange: { from: content.from, to: content.from + markerIndex },
    backRange: {
      from: content.from + markerIndex + marker.length,
      to: priorityIndex >= 0 ? content.from + priorityIndex : line.to
    }
  });
}

function parseInlineCard(
  line: SourceLine,
  content: CardLineContent,
  ordinal: number,
  headings: string[],
  listContext: string[]
): ParsedCard | undefined {
  const imageMatch = content.text.match(IMAGE_PATTERN);
  if (imageMatch && (imageMatch[1]?.trim() || imageMatch[2]?.trim())) {
    return inlineCard(
      ordinal,
      "image-occlusion",
      line,
      IMAGE_MARKER,
      imageMatch[1]?.trim() ?? "",
      imageMatch[2]?.trim() ?? "",
      parsePriority(imageMatch[3]),
      headings,
      listContext,
      content
    );
  }

  const reverseIndex = content.text.indexOf(REVERSE_MARKER);
  if (reverseIndex >= 0) {
    const front = content.text.slice(0, reverseIndex).trim();
    const priorityResult = stripPriority(content.text.slice(reverseIndex + REVERSE_MARKER.length));
    if (front && priorityResult.value) {
      return inlineCard(
        ordinal,
        "reverse",
        line,
        REVERSE_MARKER,
        front,
        priorityResult.value,
        priorityResult.priority,
        headings,
        listContext,
        content
      );
    }
  }

  const basicIndex = content.text.indexOf(BASIC_MARKER);
  if (basicIndex >= 0) {
    const front = content.text.slice(0, basicIndex).trim();
    const priorityResult = stripPriority(content.text.slice(basicIndex + BASIC_MARKER.length));
    if (front && priorityResult.value) {
      return inlineCard(
        ordinal,
        "basic",
        line,
        BASIC_MARKER,
        front,
        priorityResult.value,
        priorityResult.priority,
        headings,
        listContext,
        content
      );
    }
  }

  const priorityResult = stripPriority(content.text);
  const clozeMatches = [...priorityResult.value.matchAll(/⟦%%oab:cloze:v1%%([^\]\n]+)⟧%%oab:end:v1%%/g)];
  if (clozeMatches.length === 0) {
    return undefined;
  }
  const clozeText = priorityResult.value.replace(
    /⟦%%oab:cloze:v1%%([^\]\n]+)⟧%%oab:end:v1%%/g,
    (_match, answer: string, offset: number) => {
      const clozeNumber = clozeMatches.findIndex((candidate) => candidate.index === offset) + 1;
      return `{{c${clozeNumber}::${answer.trim()}}}`;
    }
  );
  const markerFrom = content.from + content.text.indexOf(CLOZE_OPEN_MARKER);
  return makeCard({
    ordinal,
    kind: "cloze",
    front: clozeText,
    back: "",
    items: [],
    priority: priorityResult.priority,
    headings,
    listContext,
    start: line,
    end: line,
    marker: { from: markerFrom, to: markerFrom + CLOZE_OPEN_MARKER.length },
    frontRange: { from: content.from, to: line.to }
  });
}

function parseNestedInlineListCards(
  lines: SourceLine[],
  startingOrdinal: number,
  headings: string[],
  listContexts: Map<number, string[]>
): ParsedCard[] {
  const cards: ParsedCard[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.text.match(FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      fence = fence === null ? marker ?? null : fence === marker ? null : fence;
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const content = cardLineContent(line);
    const card = parseInlineCard(
      line,
      content,
      startingOrdinal + cards.length,
      headings,
      listContexts.get(line.number) ?? []
    );
    if (card) {
      cards.push(card);
    }
  }
  return cards;
}

function toSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let lineNumber = 0;
  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    const rawTo = newline === -1 ? source.length : newline;
    const contentTo = rawTo > from && source.charAt(rawTo - 1) === "\r" ? rawTo - 1 : rawTo;
    lines.push({ number: lineNumber, from, to: contentTo, text: source.slice(from, contentTo) });
    lineNumber += 1;
    if (newline === -1) {
      break;
    }
    from = newline + 1;
  }
  return lines;
}

function cardLineContent(line: SourceLine): CardLineContent {
  const match = line.text.match(LIST_ITEM_PATTERN);
  const text = match?.[2];
  if (text === undefined) {
    return { text: line.text, from: line.from, isListItem: false };
  }
  const prefixLength = line.text.length - text.length;
  return { text, from: line.from + prefixLength, isListItem: true };
}

function collectListContexts(lines: SourceLine[]): Map<number, string[]> {
  const contexts = new Map<number, string[]>();
  const stack: Array<{ indent: number; text: string }> = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.text.match(FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      fence = fence === null ? marker ?? null : fence === marker ? null : fence;
      contexts.set(line.number, stack.map((entry) => entry.text));
      continue;
    }
    if (fence !== null) {
      contexts.set(line.number, stack.map((entry) => entry.text));
      continue;
    }

    const item = line.text.match(LIST_ITEM_PATTERN);
    if (item) {
      const indent = visualIndent(item[1] ?? "");
      while (stack.length > 0 && (stack.at(-1)?.indent ?? -1) >= indent) {
        stack.pop();
      }
      contexts.set(line.number, stack.map((entry) => entry.text));
      const text = listContextLabel(item[2] ?? "");
      if (text) {
        stack.push({ indent, text });
      }
      continue;
    }

    if (!line.text.trim()) {
      contexts.set(line.number, stack.map((entry) => entry.text));
      continue;
    }
    const indentation = line.text.match(/^\s*/)?.[0] ?? "";
    const indent = visualIndent(indentation);
    if (indent === 0) {
      stack.length = 0;
    } else {
      while (stack.length > 0 && (stack.at(-1)?.indent ?? -1) >= indent) {
        stack.pop();
      }
    }
    contexts.set(line.number, stack.map((entry) => entry.text));
  }
  return contexts;
}

function visualIndent(value: string): number {
  let width = 0;
  for (const character of value) {
    width += character === "\t" ? 4 - (width % 4) : 1;
  }
  return width;
}

function listContextLabel(value: string): string {
  const sanitized = sanitizeNestedInlineCards(value).replace(/\s+/g, " ").trim();
  return sanitized.length > 160 ? `${sanitized.slice(0, 157)}…` : sanitized;
}

function updateHeadingPath(headings: string[], line: string): void {
  const match = line.match(HEADING_PATTERN);
  if (!match) {
    return;
  }
  const level = match[1]?.length ?? 1;
  headings.splice(level - 1);
  headings[level - 1] = match[2]?.trim() ?? "";
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index] === undefined) {
      headings[index] = "";
    }
  }
}

function parsePriority(raw: string | undefined): Priority | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return value >= 1 && value <= 4 ? (value as Priority) : undefined;
}

function stripPriority(value: string): PriorityResult {
  const match = value.match(PRIORITY_PATTERN);
  if (!match) {
    return { value: value.trim() };
  }
  return {
    value: value.slice(0, match.index).trim(),
    priority: parsePriority(match[1])
  };
}

function findBlockEnd(lines: SourceLine[], startIndex: number, marker: string): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && line.text.trimStart().startsWith(marker)) {
      return index;
    }
  }
  return -1;
}

function markerRange(line: SourceLine, marker: string): TextRange {
  const index = line.text.indexOf(marker);
  return { from: line.from + index, to: line.from + index + marker.length };
}

function blockRange(lines: SourceLine[]): TextRange | undefined {
  const first = lines[0];
  const last = lines.at(-1);
  return first && last ? { from: first.from, to: last.to } : undefined;
}

function parseListItems(lines: SourceLine[]): { items: string[]; ranges: TextRange[] } {
  const candidates = lines
    .map((line) => ({ line, match: line.text.match(LIST_ITEM_PATTERN) }))
    .filter((candidate): candidate is { line: SourceLine; match: RegExpMatchArray } => candidate.match !== null);
  const baseIndent = candidates.length > 0 ? Math.min(...candidates.map(({ match }) => match[1]?.length ?? 0)) : 0;
  const items: string[] = [];
  const ranges: TextRange[] = [];

  for (const line of lines) {
    const match = line.text.match(LIST_ITEM_PATTERN);
    const indent = match?.[1]?.length ?? Number.POSITIVE_INFINITY;
    if (match && indent === baseIndent) {
      items.push(sanitizeNestedInlineCards(match[2]?.trim() ?? ""));
      ranges.push({ from: line.from, to: line.to });
    } else if (items.length > 0 && line.text.trim()) {
      const lastIndex = items.length - 1;
      items[lastIndex] = `${items[lastIndex]}\n${sanitizeNestedInlineCards(line.text)}`;
      const previousRange = ranges[lastIndex];
      if (previousRange) {
        previousRange.to = line.to;
      }
    }
  }

  return { items, ranges };
}

function sanitizeNestedInlineCards(value: string): string {
  let sanitized = value;
  for (const marker of [BASIC_MARKER, REVERSE_MARKER, IMAGE_MARKER]) {
    const index = sanitized.indexOf(marker);
    if (index >= 0) {
      sanitized = sanitized.slice(0, index);
      break;
    }
  }
  sanitized = sanitized.replace(
    /⟦%%oab:cloze:v1%%([^\]\n]+)⟧%%oab:end:v1%%/g,
    (_match, answer: string) => answer.trim()
  );
  return stripPriority(sanitized).value.trimEnd();
}
