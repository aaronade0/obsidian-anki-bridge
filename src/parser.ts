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

      const listStart = line.text.match(LIST_START_PATTERN);
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
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, LIST_START_MARKER),
              frontRange: { from: line.from, to: line.from + Math.max(0, line.text.indexOf(LIST_START_MARKER)) },
              backRange: blockRange(blockLines),
              itemRanges: itemResult.ranges
            })
          );
          index = endIndex;
        }
        // An unfinished structured block is invalid, not a one-line basic card.
        continue;
      }

      const dumpStart = line.text.match(DUMP_START_PATTERN);
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
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, DUMP_START_MARKER),
              frontRange: { from: line.from, to: line.from + Math.max(0, line.text.indexOf(DUMP_START_MARKER)) },
              backRange: blockRange(bodyLines)
            })
          );
          index = endIndex;
        }
        continue;
      }

      const imageMatch = line.text.match(IMAGE_PATTERN);
      if (imageMatch && (imageMatch[1]?.trim() || imageMatch[2]?.trim())) {
        cards.push(
          inlineCard(
            cards.length,
            "image-occlusion",
            line,
            IMAGE_MARKER,
            imageMatch[1]?.trim() ?? "",
            imageMatch[2]?.trim() ?? "",
            parsePriority(imageMatch[3]),
            headings
          )
        );
        continue;
      }

      const reverseIndex = line.text.indexOf(REVERSE_MARKER);
      if (reverseIndex >= 0) {
        const front = line.text.slice(0, reverseIndex).trim();
        const priorityResult = stripPriority(line.text.slice(reverseIndex + REVERSE_MARKER.length));
        if (front && priorityResult.value) {
          cards.push(
            inlineCard(cards.length, "reverse", line, REVERSE_MARKER, front, priorityResult.value, priorityResult.priority, headings)
          );
          continue;
        }
      }

      const basicIndex = line.text.indexOf(BASIC_MARKER);
      if (basicIndex >= 0) {
        const front = line.text.slice(0, basicIndex).trim();
        const priorityResult = stripPriority(line.text.slice(basicIndex + BASIC_MARKER.length));
        if (front && priorityResult.value) {
          cards.push(
            inlineCard(cards.length, "basic", line, BASIC_MARKER, front, priorityResult.value, priorityResult.priority, headings)
          );
          continue;
        }
      }

      const clozeMatches = [...line.text.matchAll(/⟦%%oab:cloze:v1%%([^\]\n]+)⟧%%oab:end:v1%%/g)];
      if (clozeMatches.length > 0) {
        const priorityResult = stripPriority(line.text);
        const clozeText = priorityResult.value.replace(/⟦%%oab:cloze:v1%%([^\]\n]+)⟧%%oab:end:v1%%/g, (_match, answer: string, offset: number) => {
          const clozeNumber = clozeMatches.findIndex((candidate) => candidate.index === offset) + 1;
          return `{{c${clozeNumber}::${answer.trim()}}}`;
        });
        const firstMatch = clozeMatches[0];
        const markerFrom = line.from + (firstMatch?.index ?? 0);
        cards.push(
          makeCard({
            ordinal: cards.length,
            kind: "cloze",
            front: clozeText,
            back: "",
            items: [],
            priority: priorityResult.priority,
            headings,
            start: line,
            end: line,
            marker: { from: markerFrom, to: markerFrom + CLOZE_OPEN_MARKER.length },
            frontRange: { from: line.from, to: line.to }
          })
        );
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
  headings: string[]
): ParsedCard {
  const markerIndex = line.text.indexOf(marker);
  const priorityIndex = line.text.search(PRIORITY_PATTERN);
  return makeCard({
    ordinal,
    kind,
    front,
    back,
    items: [],
    priority,
    headings,
    start: line,
    end: line,
    marker: { from: line.from + markerIndex, to: line.from + markerIndex + marker.length },
    frontRange: { from: line.from, to: line.from + markerIndex },
    backRange: {
      from: line.from + markerIndex + marker.length,
      to: priorityIndex >= 0 ? line.from + priorityIndex : line.to
    }
  });
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
      items.push(match[2]?.trim() ?? "");
      ranges.push({ from: line.from, to: line.to });
    } else if (items.length > 0 && line.text.trim()) {
      const lastIndex = items.length - 1;
      items[lastIndex] = `${items[lastIndex]}\n${line.text}`;
      const previousRange = ranges[lastIndex];
      if (previousRange) {
        previousRange.to = line.to;
      }
    }
  }

  return { items, ranges };
}
