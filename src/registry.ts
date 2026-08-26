import { createKey, normalizeForFingerprint, stableHash } from "./hash";
import type { ParsedCard, RegistryCard, RegistryChild, RegistryFile } from "./types";

export interface ReconcileResult {
  file: RegistryFile;
  activeCards: RegistryCard[];
  missingCards: RegistryCard[];
  relocatedCards: Array<{ card: RegistryCard; oldPath: string }>;
}

export function reconcileFile(
  path: string,
  source: string,
  parsedCards: ParsedCard[],
  files: RegistryFile[],
  cards: RegistryCard[],
  now = Date.now(),
  movableCards: RegistryCard[] = []
): ReconcileResult {
  let file = files.find((candidate) => candidate.path === path);
  if (!file) {
    file = {
      key: createKey("file"),
      path,
      contentHash: stableHash(source),
      lastSeen: now
    };
    files.push(file);
  } else {
    file.contentHash = stableHash(source);
    file.lastSeen = now;
    file.missingReason = undefined;
  }

  const existing = cards.filter((card) => card.fileKey === file.key);
  const unmatchedExisting = new Set(existing);
  const matches = new Map<ParsedCard, RegistryCard>();
  const relocatedCards: Array<{ card: RegistryCard; oldPath: string }> = [];

  // Exact content matches survive reordering without relying on line numbers.
  for (const parsed of parsedCards) {
    const candidates = [...unmatchedExisting].filter(
      (card) => card.kind === parsed.kind && card.fingerprint === parsed.fingerprint
    );
    const match = nearestByOrdinal(candidates, parsed.ordinal);
    if (match) {
      matches.set(parsed, match);
      unmatchedExisting.delete(match);
    }
  }

  // A uniquely verified card that was cut from another still-existing note can
  // be adopted before positional matching. Its bridge key and Anki note IDs
  // therefore travel with the Markdown instead of creating a fresh note.
  const unusedMovable = new Set(movableCards);
  for (const parsed of parsedCards) {
    if (matches.has(parsed)) {
      continue;
    }
    const candidates = [...unusedMovable].filter(
      (card) => card.kind === parsed.kind && card.fingerprint === parsed.fingerprint
    );
    if (candidates.length !== 1 || !candidates[0]) {
      continue;
    }
    const match = candidates[0];
    unusedMovable.delete(match);
    matches.set(parsed, match);
    relocatedCards.push({ card: match, oldPath: match.sourcePath });
  }

  // Edited cards keep their identity when their type and relative position agree.
  // This is deliberately scoped to one known file; ambiguous file moves are handled
  // separately and never guessed here.
  for (const parsed of parsedCards) {
    if (matches.has(parsed)) {
      continue;
    }
    const candidates = [...unmatchedExisting].filter((card) => card.kind === parsed.kind);
    const match = nearestByOrdinal(candidates, parsed.ordinal);
    if (match) {
      matches.set(parsed, match);
      unmatchedExisting.delete(match);
    }
  }

  const activeCards = parsedCards.map((parsed) => {
    const prior = matches.get(parsed);
    const card: RegistryCard = prior ?? {
      key: createKey("card"),
      fileKey: file.key,
      sourcePath: path,
      kind: parsed.kind,
      fingerprint: parsed.fingerprint,
      ordinal: parsed.ordinal,
      startOffset: parsed.ranges.whole.from,
      endOffset: parsed.ranges.whole.to,
      headingPath: [...parsed.headingPath],
      status: "active",
      children: [],
      lastSeen: now
    };

    card.sourcePath = path;
    card.fileKey = file.key;
    card.kind = parsed.kind;
    card.fingerprint = parsed.fingerprint;
    card.ordinal = parsed.ordinal;
    card.startOffset = parsed.ranges.whole.from;
    card.endOffset = parsed.ranges.whole.to;
    card.headingPath = [...parsed.headingPath];
    card.listContext = [...parsed.listContext];
    card.preview = cardPreview(parsed.front);
    card.status = "active";
    card.lastSeen = now;
    card.children = parsed.kind === "list" ? reconcileChildren(card.children, parsed.items) : card.children;

    if (!prior) {
      cards.push(card);
    }
    return card;
  });

  const missingCards = [...unmatchedExisting];
  for (const missing of missingCards) {
    missing.status = "missing";
  }

  return { file, activeCards, missingCards, relocatedCards };
}

export function moveRegistryFile(file: RegistryFile, cards: RegistryCard[], newPath: string, now = Date.now()): void {
  file.path = newPath;
  file.lastSeen = now;
  file.missingReason = undefined;
  for (const card of cards) {
    if (card.fileKey === file.key) {
      card.sourcePath = newPath;
    }
  }
}

export function itemFingerprint(item: string): string {
  return stableHash(normalizeForFingerprint(item));
}

function reconcileChildren(existing: RegistryChild[], items: string[]): RegistryChild[] {
  const unmatched = new Set(existing);
  const result: RegistryChild[] = [];

  for (const [ordinal, item] of items.entries()) {
    const fingerprint = itemFingerprint(item);
    const exact = nearestChild(
      [...unmatched].filter((candidate) => candidate.fingerprint === fingerprint),
      ordinal
    );
    const positional = exact ?? nearestChild([...unmatched], ordinal);
    if (positional) {
      unmatched.delete(positional);
      positional.fingerprint = fingerprint;
      positional.ordinal = ordinal;
      positional.preview = cardPreview(item);
      positional.status = "active";
      result.push(positional);
    } else {
      result.push({ key: createKey("item"), fingerprint, ordinal, preview: cardPreview(item), status: "active" });
    }
  }

  // Removed list items are retained as missing children so their Anki notes can
  // be quarantined rather than silently deleted. Active items are always first.
  for (const child of unmatched) {
    child.status = "missing";
  }
  return [...result, ...unmatched];
}

function cardPreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

function nearestByOrdinal(candidates: RegistryCard[], ordinal: number): RegistryCard | undefined {
  return candidates.sort((left, right) => {
    const distance = Math.abs(left.ordinal - ordinal) - Math.abs(right.ordinal - ordinal);
    return distance !== 0 ? distance : left.key.localeCompare(right.key);
  })[0];
}

function nearestChild(candidates: RegistryChild[], ordinal: number): RegistryChild | undefined {
  return candidates.sort((left, right) => {
    const distance = Math.abs(left.ordinal - ordinal) - Math.abs(right.ordinal - ordinal);
    return distance !== 0 ? distance : left.key.localeCompare(right.key);
  })[0];
}
