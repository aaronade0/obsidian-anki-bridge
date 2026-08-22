export interface OwnedNoteInfo {
  fields?: Record<string, { value: string }>;
  tags: string[];
}

export function ownershipTag(cardKey: string): string {
  return `oab-id-${cardKey}`;
}

export function noteBelongsToCardKey(note: OwnedNoteInfo, cardKey: string): boolean {
  return note.fields?.CardKey?.value === cardKey || note.tags.includes(ownershipTag(cardKey));
}
