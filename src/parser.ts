import { normalizeForFingerprint, stableHash } from "./hash";
import { inlineCodeRanges, offsetInsideRanges } from "./inline-code";
import {
  collectTags,
  isOnlyTags,
  mergeTags,
  stripTrailingTags,
  trailingTagMatch
} from "./tags";
import type { CardKind, ParsedCard, TextRange } from "./types";
import { describeEmbeds } from "./wikilink";

interface SourceLine {
  number: number;
  from: number;
  to: number;
  text: string;
}

interface TagResult {
  value: string;
  tags: string[];
}

interface CardLineContent {
  text: string;
  from: number;
  isListItem: boolean;
}
export const BASIC_MARKER = "⇢%%oab:basic:v1%%";
export const REVERSE_MARKER = "⇄%%oab:reverse:v1%%";
export const LIST_START_MARKER = "⇢[%%oab:list:v1%%";
export const LIST_END_MARKER = "]⇠%%oab:end:v1%%";
export const DUMP_START_MARKER = "⇢{%%oab:dump:v1%%";
export const DUMP_END_MARKER = "}⇠%%oab:end:v1%%";
export const IMAGE_MARKER = "⇢▣%%oab:image:v1%%";
export const CLOZE_OPEN_MARKER = "⟦%%oab:cloze:v1%%";
export const CLOZE_CLOSE_MARKER = "⟧%%oab:end:v1%%";

const CANONICAL_MARKER_FRAGMENT = "%%oab:";

const LIST_START_PATTERN = /^(.*?)\s*⇢\[%%oab:list:v1%%\s*(.*?)\s*$/;
const DUMP_START_PATTERN = /^(.*?)\s*⇢\{%%oab:dump:v1%%\s*(.*?)\s*$/;
const IMAGE_PATTERN = /^(.*?)\s*⇢▣%%oab:image:v1%%\s*(.*?)\s*$/;
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

      const clozeTableRow = parseClozeTableRow(
        lines,
        index,
        cards.length,
        headings,
        listContexts
      );
      if (clozeTableRow) {
        cards.push(clozeTableRow);
        continue;
      }

      const cardLine = cardLineContent(line);

      const listStart = markerIsActive(cardLine.text, LIST_START_MARKER)
        ? blockStartMatch(cardLine.text, LIST_START_PATTERN)
        : undefined;
      if (listStart) {
        const endIndex = findBlockEnd(lines, index + 1, LIST_END_MARKER);
        if (endIndex !== -1) {
          const front = listStart.front;
          const blockLines = lines.slice(index + 1, endIndex);
          const itemResult = parseListItems(blockLines);
          const tags = mergeTags(listStart.tags, closingLineTags(lines[endIndex], LIST_END_MARKER));
          cards.push(
            makeCard({
              ordinal: cards.length,
              kind: "list",
              front,
              back: "",
              items: itemResult.items,
              tags,
              itemTags: itemResult.itemTags,
              headings,
              listContext: listContexts.get(line.number) ?? [],
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, LIST_START_MARKER),
              frontRange: blockFrontRange(cardLine, LIST_START_MARKER),
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

      const dumpStart = markerIsActive(cardLine.text, DUMP_START_MARKER)
        ? blockStartMatch(cardLine.text, DUMP_START_PATTERN)
        : undefined;
      if (dumpStart) {
        const endIndex = findBlockEnd(lines, index + 1, DUMP_END_MARKER);
        if (endIndex !== -1) {
          const bodyLines = lines.slice(index + 1, endIndex);
          const body = parseDumpBody(bodyLines);
          cards.push(
            makeCard({
              ordinal: cards.length,
              kind: "dump",
              front: dumpStart.front,
              back: body.value,
              items: [],
              tags: mergeTags(
                dumpStart.tags,
                body.tags,
                closingLineTags(lines[endIndex], DUMP_END_MARKER)
              ),
              headings,
              listContext: listContexts.get(line.number) ?? [],
              start: line,
              end: lines[endIndex] ?? line,
              marker: markerRange(line, DUMP_START_MARKER),
              frontRange: blockFrontRange(cardLine, DUMP_START_MARKER),
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
  tags?: string[];
  itemTags?: string[][];
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
    tags: [...(input.tags ?? [])],
    itemTags: (input.itemTags ?? []).map((tags) => [...tags]),
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
  headings: string[],
  listContext: string[],
  content: CardLineContent
): ParsedCard {
  const markerIndex = content.text.indexOf(marker);
  const trailingTags = trailingTagMatch(content.text);
  return makeCard({
    ordinal,
    kind,
    front,
    back,
    items: [],
    tags: collectTags(content.text),
    headings,
    listContext,
    start: line,
    end: line,
    marker: { from: content.from + markerIndex, to: content.from + markerIndex + marker.length },
    frontRange: { from: content.from, to: content.from + markerIndex },
    backRange: {
      from: content.from + markerIndex + marker.length,
      to: trailingTags ? content.from + trailingTags.index : line.to
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
  const imageMatch = markerIsActive(content.text, IMAGE_MARKER)
    ? content.text.match(IMAGE_PATTERN)
    : null;
  if (imageMatch) {
    const imageFront = stripTrailingTags(imageMatch[1] ?? "").value;
    const imageBack = stripTrailingTags(imageMatch[2] ?? "").value;
    if (imageFront || imageBack) {
      return inlineCard(
        ordinal,
        "image-occlusion",
        line,
        IMAGE_MARKER,
        imageFront,
        imageBack,
        headings,
        listContext,
        content
      );
    }
  }

  const reverseIndex = activeMarkerIndex(content.text, REVERSE_MARKER);
  if (reverseIndex >= 0) {
    const front = stripTrailingTags(content.text.slice(0, reverseIndex)).value;
    const backResult = stripTrailingTags(content.text.slice(reverseIndex + REVERSE_MARKER.length));
    if (front && backResult.value) {
      return inlineCard(
        ordinal,
        "reverse",
        line,
        REVERSE_MARKER,
        front,
        backResult.value,
        headings,
        listContext,
        content
      );
    }
  }

  const basicIndex = activeMarkerIndex(content.text, BASIC_MARKER);
  if (basicIndex >= 0) {
    const front = stripTrailingTags(content.text.slice(0, basicIndex)).value;
    const backResult = stripTrailingTags(content.text.slice(basicIndex + BASIC_MARKER.length));
    if (front && backResult.value) {
      return inlineCard(
        ordinal,
        "basic",
        line,
        BASIC_MARKER,
        front,
        backResult.value,
        headings,
        listContext,
        content
      );
    }
  }

  const tagResult = stripTrailingTags(content.text);
  const clozeMatches = activeClozeMatches(tagResult.value);
  if (clozeMatches.length === 0) {
    return undefined;
  }
  const clozeText = tagResult.value.replace(
    /⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g,
    (_match, answer: string, offset: number) => {
      const clozeNumber = clozeMatches.findIndex((candidate) => candidate.index === offset) + 1;
      if (clozeNumber === 0) {
        return _match;
      }
      return ankiCloze(clozeNumber, answer);
    }
  );
  const markerFrom = content.from + (clozeMatches[0]?.index ?? 0);
  return makeCard({
    ordinal,
    kind: "cloze",
    front: clozeText,
    back: "",
    items: [],
    tags: collectTags(content.text),
    headings,
    listContext,
    start: line,
    end: line,
    marker: { from: markerFrom, to: markerFrom + CLOZE_OPEN_MARKER.length },
    frontRange: {
      from: content.from,
      to: (() => {
        const trailing = trailingTagMatch(content.text);
        return trailing ? content.from + trailing.index : line.to;
      })()
    }
  });
}

function parseClozeTableRow(
  lines: SourceLine[],
  index: number,
  ordinal: number,
  headings: string[],
  listContexts: Map<number, string[]>
): ParsedCard | undefined {
  const current = lines[index];
  if (!current || activeClozeMatches(current.text).length === 0 || !isTableRow(current.text)) {
    return undefined;
  }

  let startIndex = index;
  while (startIndex > 0 && isTableRow(lines[startIndex - 1]?.text ?? "")) {
    startIndex -= 1;
  }
  let endIndex = index;
  while (endIndex + 1 < lines.length && isTableRow(lines[endIndex + 1]?.text ?? "")) {
    endIndex += 1;
  }

  const delimiterIndex = startIndex + 1;
  if (index === delimiterIndex || !isTableDelimiter(lines[delimiterIndex]?.text ?? "")) {
    return undefined;
  }

  const convertedCurrent = numberedClozeText(current.text);
  if (!convertedCurrent) {
    return undefined;
  }

  const tableText = lines.slice(startIndex, endIndex + 1)
    .map((tableLine, relativeIndex) => {
      const absoluteIndex = startIndex + relativeIndex;
      return absoluteIndex === index ? convertedCurrent : revealClozeAnswers(tableLine.text);
    })
    .join("\n");
  const firstMarkerFrom = current.from + current.text.indexOf(CLOZE_OPEN_MARKER);
  return makeCard({
    ordinal,
    kind: "cloze",
    front: tableText,
    back: "",
    items: [],
    tags: collectTags(current.text),
    headings,
    listContext: listContexts.get(current.number) ?? [],
    start: current,
    end: current,
    marker: {
      from: firstMarkerFrom,
      to: firstMarkerFrom + CLOZE_OPEN_MARKER.length
    },
    frontRange: { from: current.from, to: current.to }
  });
}

function isTableRow(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.includes("|") && !FENCE_PATTERN.test(trimmed);
}

function isTableDelimiter(value: string): boolean {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function numberedClozeText(value: string): string | undefined {
  const clozePattern = /⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g;
  const matches = activeClozeMatches(value);
  if (matches.length === 0) {
    return undefined;
  }
  let clozeNumber = 0;
  return value.replace(clozePattern, (match, answer: string, offset: number) => {
    if (!matches.some((candidate) => candidate.index === offset)) {
      return match;
    }
    clozeNumber += 1;
    return ankiCloze(clozeNumber, answer);
  });
}

function ankiCloze(clozeNumber: number, answer: string): string {
  // Anki treats every adjacent `}}` as the end of a cloze. TeX commonly
  // creates that sequence when nested groups close (for example g^{2}} in
  // \frac{g^{2}}{8 \pi G}). Whitespace is semantically inert in TeX and
  // prevents the inner braces from prematurely terminating the deletion.
  return `{{c${clozeNumber}::${answer.trim().replaceAll("}}", "} }")}}}`;
}

function revealClozeAnswers(value: string): string {
  const matches = activeClozeMatches(value);
  return value.replace(
    /⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g,
    (match, answer: string, offset: number) =>
      matches.some((candidate) => candidate.index === offset) ? answer.trim() : match
  );
}

function activeClozeMatches(value: string): RegExpMatchArray[] {
  const codeRanges = inlineCodeRanges(value);
  return [...value.matchAll(/⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g)]
    .filter((match) => !offsetInsideRanges(match.index ?? -1, codeRanges));
}

function markerIsActive(value: string, marker: string): boolean {
  return activeMarkerIndex(value, marker) >= 0;
}

function activeMarkerIndex(value: string, marker: string): number {
  const codeRanges = inlineCodeRanges(value);
  let from = 0;
  while (from < value.length) {
    const index = value.indexOf(marker, from);
    if (index < 0) {
      return -1;
    }
    if (!offsetInsideRanges(index, codeRanges)) {
      return index;
    }
    from = index + marker.length;
  }
  return -1;
}

export function maskMarkdownCode(source: string): string {
  const lines = source.split("\n");
  let fence: string | null = null;
  return lines.map((line) => {
    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      fence = fence === null ? marker ?? null : fence === marker ? null : fence;
      return " ".repeat(line.length);
    }
    if (fence !== null) {
      return " ".repeat(line.length);
    }
    // String offsets throughout the parser are UTF-16 code-unit offsets. Keep
    // the same representation here so emoji before a code span cannot shift
    // the masked range and expose a documented marker accidentally.
    const characters = line.split("");
    for (const range of inlineCodeRanges(line)) {
      characters.fill(" ", range.from, range.to);
    }
    return characters.join("");
  }).join("\n");
}

export function containsActiveCanonicalMarker(source: string): boolean {
  return maskMarkdownCode(source).includes(CANONICAL_MARKER_FRAGMENT);
}

function parseNestedInlineListCards(
  lines: SourceLine[],
  startingOrdinal: number,
  headings: string[],
  listContexts: Map<number, string[]>
): ParsedCard[] {
  const cards: ParsedCard[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const fenceMatch = line.text.match(FENCE_PATTERN);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      fence = fence === null ? marker ?? null : fence === marker ? null : fence;
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const clozeTableRow = parseClozeTableRow(
      lines,
      index,
      startingOrdinal + cards.length,
      headings,
      listContexts
    );
    if (clozeTableRow) {
      cards.push(clozeTableRow);
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
      const text = contextLabel(item[2] ?? "");
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

/**
 * Headings and list ancestors often carry a flashcard themselves. Context has
 * to stay answerable, so only the part a reviewer would see on the front of
 * that card survives: everything before the card marker, and cloze deletions
 * masked instead of revealed.
 */
export function contextLabel(value: string): string {
  const withoutAnswer = maskClozeDeletions(truncateAtCardMarker(value));
  const sanitized = describeEmbeds(stripTrailingTags(withoutAnswer).value)
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length > 160 ? `${sanitized.slice(0, 157)}…` : sanitized;
}

const CONTEXT_MARKERS = [
  BASIC_MARKER,
  REVERSE_MARKER,
  IMAGE_MARKER,
  LIST_START_MARKER,
  DUMP_START_MARKER
];

function truncateAtCardMarker(value: string): string {
  const indexes = CONTEXT_MARKERS
    .map((marker) => activeMarkerIndex(value, marker))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value;
}

function maskClozeDeletions(value: string): string {
  const matches = activeClozeMatches(value);
  return value.replace(
    /⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g,
    (match, _answer: string, offset: number) =>
      matches.some((candidate) => candidate.index === offset) ? CLOZE_GAP : match
  );
}

export const CLOZE_GAP = "[…]";

function updateHeadingPath(headings: string[], line: string): void {
  const match = line.match(HEADING_PATTERN);
  if (!match) {
    return;
  }
  const level = match[1]?.length ?? 1;
  headings.splice(level - 1);
  headings[level - 1] = contextLabel(match[2] ?? "");
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index] === undefined) {
      headings[index] = "";
    }
  }
}

interface BlockStart {
  front: string;
  tags: string[];
}

/**
 * A block marker may be followed by tags, but never by content: text after the
 * opening marker would silently disappear from the card.
 */
function blockStartMatch(text: string, pattern: RegExp): BlockStart | undefined {
  const match = text.match(pattern);
  if (!match) {
    return undefined;
  }
  const trailing = match[2] ?? "";
  if (trailing.trim() && !isOnlyTags(trailing)) {
    return undefined;
  }
  return {
    front: stripTrailingTags(match[1] ?? "").value,
    tags: collectTags(text)
  };
}

/** The trailing tags of a block's opening line are metadata, not front text. */
function blockFrontRange(content: CardLineContent, marker: string): TextRange {
  const markerIndex = Math.max(0, content.text.indexOf(marker));
  const frontText = content.text.slice(0, markerIndex);
  const trailing = trailingTagMatch(frontText);
  return {
    from: content.from,
    to: content.from + (trailing ? trailing.index : markerIndex)
  };
}

function closingLineTags(line: SourceLine | undefined, marker: string): string[] {
  return collectTags(line?.text.replace(marker, "") ?? "");
}

/** Lines that only hold tags are metadata for the block, not dumped content. */
function parseDumpBody(lines: SourceLine[]): TagResult {
  const tags: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    tags.push(...collectTags(line.text));
    if (!isOnlyTags(line.text)) {
      kept.push(line.text);
    }
  }
  return { value: kept.join("\n").trim(), tags: mergeTags(tags) };
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

function parseListItems(lines: SourceLine[]): {
  items: string[];
  ranges: TextRange[];
  itemTags: string[][];
  tags: string[];
} {
  const candidates = lines
    .map((line) => ({ line, match: line.text.match(LIST_ITEM_PATTERN) }))
    .filter((candidate): candidate is { line: SourceLine; match: RegExpMatchArray } => candidate.match !== null);
  const baseIndent = candidates.length > 0 ? Math.min(...candidates.map(({ match }) => match[1]?.length ?? 0)) : 0;
  const items: string[] = [];
  const ranges: TextRange[] = [];
  const itemTags: string[][] = [];

  for (const line of lines) {
    const match = line.text.match(LIST_ITEM_PATTERN);
    const indent = match?.[1]?.length ?? Number.POSITIVE_INFINITY;
    if (match && indent === baseIndent) {
      items.push(sanitizeNestedInlineCards(match[2]?.trim() ?? ""));
      ranges.push({ from: line.from, to: trailingContentEnd(line) });
      itemTags.push(collectTags(line.text));
    } else if (items.length > 0 && line.text.trim()) {
      const lastIndex = items.length - 1;
      items[lastIndex] = `${items[lastIndex]}\n${sanitizeNestedInlineCards(line.text)}`;
      const previousRange = ranges[lastIndex];
      if (previousRange) {
        previousRange.to = trailingContentEnd(line);
      }
      itemTags[lastIndex] = mergeTags(itemTags[lastIndex] ?? [], collectTags(line.text));
    }
  }

  return { items, ranges, itemTags, tags: mergeTags(...itemTags) };
}

function trailingContentEnd(line: SourceLine): number {
  const trailing = trailingTagMatch(line.text);
  return trailing ? line.from + trailing.index : line.to;
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
    /⟦%%oab:cloze:v1%%([^\n]+?)⟧%%oab:end:v1%%/g,
    (_match, answer: string) => answer.trim()
  );
  return stripTrailingTags(sanitized).value.trimEnd();
}
