export function deriveDeckName(deckRoot: string, vaultName: string, sourcePath: string): string {
  const normalizedPath = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  const fileName = segments.pop() ?? "Untitled";
  const noteName = fileName.replace(/\.md$/i, "");
  return [deckRoot, vaultName, ...segments, noteName].map(sanitizeDeckSegment).filter(Boolean).join("::");
}

export function sanitizeDeckSegment(segment: string): string {
  return segment.replace(/::/g, "∷").replace(/[\r\n\t]/g, " ").trim();
}

export function sourceContext(sourcePath: string, headingPath: string[]): {
  folderPath: string;
  noteName: string;
  headingPath: string[];
} {
  const normalized = sourcePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.pop() ?? "Untitled.md";
  const noteName = fileName.replace(/\.md$/i, "");
  const cleanedHeadings = headingPath.filter(Boolean);
  if (cleanedHeadings[0]?.localeCompare(noteName, undefined, { sensitivity: "accent" }) === 0) {
    cleanedHeadings.shift();
  }
  return {
    folderPath: segments.join("/"),
    noteName,
    headingPath: cleanedHeadings
  };
}
