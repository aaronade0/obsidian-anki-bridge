import { escapeHtml, renderVaultLink, vaultLinkHref } from "./source-link";
import { replaceInternalLinks, type LinkResolver, type WikiLink } from "./wikilink";

export interface VaultLinkContext {
  vaultName: string;
  sourcePath: string;
  resolve: LinkResolver;
}

const PLACEHOLDER_BOUNDARY = "\u0000";
const PLACEHOLDER_PATTERN = /\u0000(\d+)\u0000/g;

export function linkAnchor(link: WikiLink, context: VaultLinkContext): string {
  const linkpath = link.linkpath || context.sourcePath;
  const resolved = context.resolve(linkpath) !== undefined;
  return renderVaultLink(
    vaultLinkHref(context.vaultName, link.linktext || linkpath, context.sourcePath),
    link.display,
    resolved
  );
}

/**
 * Escapes plain text and turns its Obsidian links into anchors. Use this
 * wherever the value is shown as-is instead of going through Markdown.
 */
export function renderLinkedText(value: string, context: VaultLinkContext): string {
  const anchors: string[] = [];
  const tokenized = replaceInternalLinks(value.replaceAll(PLACEHOLDER_BOUNDARY, ""), (link) => {
    anchors.push(linkAnchor(link, context));
    return `${PLACEHOLDER_BOUNDARY}${anchors.length - 1}${PLACEHOLDER_BOUNDARY}`;
  });
  // `escapeHtml` only rewrites `&<>'"`, so the boundaries survive and the
  // anchors can be put back once the surrounding text is safe.
  return escapeHtml(tokenized).replace(
    PLACEHOLDER_PATTERN,
    (match, index: string) => anchors[Number.parseInt(index, 10)] ?? match
  );
}
