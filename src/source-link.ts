export function renderContext(
  folderPath: string,
  noteName: string,
  headings: string[],
  href: string,
  listContext: string[] = []
): string {
  const folder = folderPath
    ? `<span class="folder">${escapeHtml(folderPath)}</span><span class="path-separator">/</span>`
    : "";
  const totalContextItems = headings.length + listContext.length;
  const headingHtml = headings.map((heading, index) => contextItem(
    "heading",
    heading,
    index,
    totalContextItems - index - 1,
    "#"
  )).join("");
  const listHtml = listContext.map((item, index) => contextItem(
    "list-context",
    item,
    headings.length + index,
    totalContextItems - headings.length - index - 1,
    "↳"
  )).join("");
  const tree = headingHtml || listHtml ? `<div class="context-tree">${headingHtml}${listHtml}</div>` : "";
  return `<div class="source-location">${folder}<a class="note" href="${escapeHtml(href)}">${escapeHtml(noteName)}</a></div>${tree}`;
}

function contextItem(
  kind: "heading" | "list-context",
  value: string,
  depth: number,
  distance: number,
  symbol: string
): string {
  const nearest = distance === 0 ? " is-nearest" : "";
  const symbolClass = kind === "heading" ? "heading-symbol" : "list-bullet";
  return `<span class="context-item ${kind}${nearest}" style="--depth:${depth};--distance:${distance}"><span class="context-symbol ${symbolClass}">${symbol}</span><span class="context-label">${escapeHtml(value)}</span></span>`;
}

export function sourceHref(vaultName: string, cardKey: string): string {
  return `obsidian://anki-bridge?vault=${encodeURIComponent(vaultName)}&card=${encodeURIComponent(cardKey)}`;
}

export function fileHref(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] ?? character);
}
