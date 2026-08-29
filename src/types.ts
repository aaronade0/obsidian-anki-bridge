export type CardKind = "basic" | "reverse" | "cloze" | "list" | "dump" | "image-occlusion";

export type Priority = 1 | 2 | 3 | 4;

export interface TextRange {
  from: number;
  to: number;
}

export interface CardRanges {
  whole: TextRange;
  marker: TextRange;
  front: TextRange;
  back?: TextRange;
  items?: TextRange[];
}

export interface ParsedCard {
  ordinal: number;
  kind: CardKind;
  front: string;
  back: string;
  items: string[];
  priority?: Priority;
  headingPath: string[];
  listContext: string[];
  fingerprint: string;
  startLine: number;
  endLine: number;
  ranges: CardRanges;
}

export interface RegistryChild {
  key: string;
  fingerprint: string;
  ordinal: number;
  preview?: string;
  ankiNoteId?: number;
  status: RegistryStatus;
}

export interface RegistryFile {
  key: string;
  path: string;
  contentHash: string;
  lastSeen: number;
  missingReason?: "deleted-in-obsidian" | "unknown";
}

export type RegistryStatus = "active" | "missing" | "conflict";

export interface RegistryCard {
  key: string;
  fileKey: string;
  sourcePath: string;
  kind: CardKind;
  fingerprint: string;
  ordinal: number;
  startOffset: number;
  endOffset: number;
  headingPath: string[];
  listContext?: string[];
  preview?: string;
  status: RegistryStatus;
  ankiNoteId?: number;
  children: RegistryChild[];
  lastSeen: number;
}

export type ConflictSeverity = "warning" | "error";

export interface SyncConflict {
  key: string;
  code: string;
  severity: ConflictSeverity;
  message: string;
  path?: string;
  cardKey?: string;
  createdAt: number;
  lastSeenAt: number;
  resolvedAt?: number;
}

export interface PluginSettings {
  ankiConnectUrl: string;
  ankiConnectApiKey: string;
  deckRoot: string;
  vaultNameOverride: string;
  autoSync: boolean;
  autoSyncDelayMs: number;
  pathAuditIntervalMinutes: number;
  showSuccessNotices: boolean;
  excludedPaths: string[];
  excludedFilenamePatterns: string[];
  includedFolders: string[];
}

export interface PluginData {
  schemaVersion: 1;
  settings: PluginSettings;
  files: RegistryFile[];
  cards: RegistryCard[];
  conflicts: SyncConflict[];
  lastSuccessfulSyncAt?: number;
}

export interface DesiredAnkiNote {
  cardKey: string;
  parentCardKey: string;
  modelName: string;
  deckName: string;
  fields: Record<string, string>;
  tags: string[];
  ownedFields: string[];
  existingNoteId?: number;
}

export interface SyncSummary {
  path: string;
  parsedCards: number;
  desiredNotes: number;
  createdNotes: number;
  updatedNotes: number;
  movedCards: number;
  conflicts: number;
}
