export function normalizeMarkdownPath(rawPath: string): string {
  let path = rawPath.trim();
  if (path.startsWith("[[") && path.endsWith("]]")) {
    path = path.slice(2, -2).trim();
  }
  if (path.includes("|") || path.includes("#")) {
    throw new Error("Enter a file path without a display alias or heading link.");
  }
  if (path.length === 0) {
    throw new Error("Enter the note's new path.");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error("Enter a vault-relative path using forward slashes.");
  }
  if (!path.toLowerCase().endsWith(".md")) {
    path += ".md";
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("The path contains an empty or unsafe folder segment.");
  }
  return path;
}
