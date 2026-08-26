export function renderContext(
  folderPath: string,
  noteName: string,
  headings: string[],
  href: string,
  listContext: string[] = []
): string {
  const folder = folderPath ? `<span class="folder">${escapeHtml(folderPath)}</span> / ` : "";
  const headingHtml = headings
    .map((heading, index) => `<span class="heading" style="--depth:${index}">${escapeHtml(heading)}</span>`)
    .join("");
  const listHtml = listContext
    .map((item, index) =>
      `<span class="list-context" style="--depth:${index}"><span class="list-bullet">↳</span>${escapeHtml(item)}</span>`
    )
    .join("");
  return `${folder}<a class="note" href="${escapeHtml(href)}">${escapeHtml(noteName)}</a>${headingHtml}${listHtml}`;
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
