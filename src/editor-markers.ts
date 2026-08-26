export interface CanonicalEditorMarkerRange {
  hiddenFrom: number;
  hiddenTo: number;
  visibleFrom: number;
  visibleTo: number;
  atomicFrom: number;
  atomicTo: number;
  isEndMarker: boolean;
}

const HIDDEN_MARKER_PATTERN = /%%oab:(?:basic|reverse|list|dump|image|cloze|end):v1%%/g;
const VISIBLE_PREFIXES = ["⇢[", "⇢{", "⇢▣", "]⇠", "}⇠", "⇢", "⇄", "⟦", "⟧"] as const;
const END_PREFIXES = new Set<string>(["]⇠", "}⇠", "⟧"]);

/**
 * Finds both the hidden implementation comment and the complete logical
 * marker. The latter is used as an atomic CodeMirror range so arrow-key
 * movement cannot stop between a visible glyph and its hidden comment.
 */
export function findCanonicalEditorMarkerRanges(source: string): CanonicalEditorMarkerRange[] {
  const ranges: CanonicalEditorMarkerRange[] = [];
  for (const match of source.matchAll(HIDDEN_MARKER_PATTERN)) {
    const hiddenFrom = match.index;
    const hiddenTo = hiddenFrom + match[0].length;
    const prefix = VISIBLE_PREFIXES.find((candidate) =>
      source.slice(Math.max(0, hiddenFrom - candidate.length), hiddenFrom) === candidate
    );
    const visibleFrom = prefix ? hiddenFrom - prefix.length : hiddenFrom;
    ranges.push({
      hiddenFrom,
      hiddenTo,
      visibleFrom,
      visibleTo: hiddenFrom,
      atomicFrom: visibleFrom,
      atomicTo: hiddenTo,
      isEndMarker: prefix !== undefined && END_PREFIXES.has(prefix)
    });
  }
  return ranges;
}
