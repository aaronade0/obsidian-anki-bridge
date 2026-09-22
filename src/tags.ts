import { inlineCodeRanges, offsetInsideRanges } from "./inline-code";

/**
 * Obsidian tag bodies accept letters, digits, underscores, hyphens and the
 * nested-tag separator. A tag that consists of digits only is not a tag, which
 * keeps TeX parameters such as `#1` out of the result.
 */
const TAG_BODY = "[\\p{L}\\p{N}_/-]";
const TAG_LEAD = "[\\s([{<\"'“„‚]";
const TAG_SOURCE = `(^|${TAG_LEAD})#(?=${TAG_BODY}*[\\p{L}_-])(${TAG_BODY}+)`;
const TRAILING_TAGS_SOURCE = `(?:(?:^|\\s)#(?=${TAG_BODY}*[\\p{L}_-])${TAG_BODY}+)+\\s*$`;

export interface TrailingTagMatch {
  index: number;
  tags: string[];
}

/**
 * Every tag written on a line that belongs to a card is part of that card, no
 * matter where on the line it sits. Tags inside inline code stay documentation.
 */
export function collectTags(value: string): string[] {
  const codeRanges = inlineCodeRanges(value);
  const tags: string[] = [];
  for (const match of value.matchAll(new RegExp(TAG_SOURCE, "gu"))) {
    const hashOffset = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (offsetInsideRanges(hashOffset, codeRanges)) {
      continue;
    }
    const tag = match[2];
    if (tag) {
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Tags that trail a card's content are metadata, not content, so they are cut
 * from the text that reaches Anki while still being collected as tags.
 */
export function trailingTagMatch(value: string): TrailingTagMatch | undefined {
  const match = value.match(new RegExp(TRAILING_TAGS_SOURCE, "u"));
  if (!match || match.index === undefined) {
    return undefined;
  }
  if (offsetInsideRanges(match.index, inlineCodeRanges(value))) {
    return undefined;
  }
  return { index: match.index, tags: collectTags(match[0]) };
}

export function stripTrailingTags(value: string): { value: string; tags: string[] } {
  const match = trailingTagMatch(value);
  if (!match) {
    return { value: value.trim(), tags: [] };
  }
  return { value: value.slice(0, match.index).trim(), tags: match.tags };
}

/** A line made of nothing but tags carries metadata and no card content. */
export function isOnlyTags(value: string): boolean {
  const stripped = stripTrailingTags(value);
  return stripped.value === "" && stripped.tags.length > 0;
}

export function mergeTags(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

/** Obsidian nests tags with `/`; Anki nests them with `::`. */
export function toAnkiTag(tag: string): string {
  return tag.replace(/\//g, "::").replace(/\s+/g, "_");
}

export function toAnkiTags(tags: string[]): string[] {
  return [...new Set(tags.map(toAnkiTag))].filter((tag) => tag.length > 0);
}
