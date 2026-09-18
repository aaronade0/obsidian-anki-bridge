import { inlineCodeRanges, isEscaped, offsetInsideRanges } from "./inline-code";

export interface WikiLink {
  /** Note reference without subpath or alias, for example `Physics/Energie`. */
  linkpath: string;
  /** Heading or block reference including the leading `#`, or an empty string. */
  subpath: string;
  /** `linkpath` plus `subpath`, which is what Obsidian's link resolver expects. */
  linktext: string;
  /** Text shown on the card. */
  display: string;
}

export interface InternalLink extends WikiLink {
  /** Vault-relative path of the resolved note, or `undefined` when it does not exist. */
  resolvedPath?: string;
}

/**
 * Resolves a link target the way Obsidian would, relative to the note that
 * contains the link. Returns the vault-relative path, or `undefined` when the
 * target does not exist.
 */
export type LinkResolver = (linkpath: string) => string | undefined;

const WIKI_LINK_PATTERN = /!?\[\[([^\[\]\n]+)\]\]/g;
const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s()\n]+))(?:\s+["'][^"'\n]*["'])?\)/g;
const EXTERNAL_TARGET_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:)/i;

export function parseWikiLink(inner: string): WikiLink | undefined {
  const pipeIndex = inner.indexOf("|");
  const target = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
  const alias = pipeIndex >= 0 ? inner.slice(pipeIndex + 1).trim() : "";
  if (!target) {
    return undefined;
  }
  const hashIndex = target.indexOf("#");
  const linkpath = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).trim();
  const subpath = hashIndex >= 0 ? target.slice(hashIndex).trim() : "";
  if (!linkpath && !subpath) {
    return undefined;
  }
  return {
    linkpath,
    subpath,
    linktext: `${linkpath}${subpath}`,
    display: alias || defaultDisplay(linkpath, subpath)
  };
}

/**
 * Reads the page Obsidian would open for a PDF embed. Obsidian writes the page
 * as `#page=16` and may append further viewer parameters such as
 * `#page=16&height=400`, so only the `page` parameter is taken.
 */
export function pdfPageFromSubpath(subpath: string): number | undefined {
  const match = /(?:^|[#&])page=(\d+)/i.exec(subpath);
  if (!match) {
    return undefined;
  }
  const page = Number.parseInt(match[1] ?? "", 10);
  return page >= 1 ? page : undefined;
}

function defaultDisplay(linkpath: string, subpath: string): string {
  const anchor = subpath.replace(/^#/, "").trim();
  if (!anchor) {
    return linkpath;
  }
  return linkpath ? `${linkpath} > ${anchor}` : anchor;
}

/**
 * Replaces every non-embed Obsidian link outside inline code with the result of
 * `replacer`. Markdown links to vault files are treated as Obsidian links too,
 * because their relative targets are meaningless inside Anki.
 */
export function replaceInternalLinks(
  value: string,
  replacer: (link: WikiLink) => string
): string {
  const withWikiLinks = replaceOutsideCode(value, WIKI_LINK_PATTERN, (match) => {
    if (match[0]?.startsWith("!")) {
      return undefined;
    }
    const link = parseWikiLink(match[1] ?? "");
    return link ? replacer(link) : undefined;
  });
  return replaceOutsideCode(withWikiLinks, MARKDOWN_LINK_PATTERN, (match) => {
    if (match[1]) {
      return undefined;
    }
    const rawTarget = (match[3] ?? match[4] ?? "").trim();
    if (!rawTarget || EXTERNAL_TARGET_PATTERN.test(rawTarget)) {
      return undefined;
    }
    const link = parseWikiLink(decodeTarget(rawTarget));
    if (!link) {
      return undefined;
    }
    const label = match[2]?.trim();
    return replacer(label ? { ...link, display: label } : link);
  });
}

function decodeTarget(rawTarget: string): string {
  try {
    return decodeURIComponent(rawTarget);
  } catch {
    return rawTarget;
  }
}

function replaceOutsideCode(
  value: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => string | undefined
): string {
  const codeRanges = inlineCodeRanges(value);
  const matches = [...value.matchAll(pattern)].filter((match) => {
    const index = match.index ?? -1;
    return index >= 0 && !offsetInsideRanges(index, codeRanges) && !isEscaped(value, index);
  });
  if (matches.length === 0) {
    return value;
  }
  let output = "";
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? cursor;
    if (index < cursor) {
      continue;
    }
    const replacement = replacer(match);
    output += value.slice(cursor, index) + (replacement ?? match[0]);
    cursor = index + match[0].length;
  }
  return output + value.slice(cursor);
}

/** Renders the display text of every Obsidian link, dropping the link syntax. */
export function stripLinkSyntax(value: string): string {
  return replaceInternalLinks(value, (link) => link.display);
}

/** Replaces `![[target|alias]]` embeds with a plain label. */
export function describeEmbeds(value: string): string {
  return value.replace(WIKI_LINK_PATTERN, (match, inner: string) => {
    if (!match.startsWith("!")) {
      return match;
    }
    const link = parseWikiLink(inner);
    if (!link) {
      return "";
    }
    const name = link.linkpath.split("/").pop() ?? link.linkpath;
    return link.display === link.linkpath ? name.replace(/\.[a-z0-9]+$/i, "") : link.display;
  });
}
