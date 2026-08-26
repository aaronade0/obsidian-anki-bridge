import { createKey } from "./hash";

export type MobileOutboxEvent =
  | MobileUpsertEvent
  | MobileRenameEvent
  | MobileDeleteEvent
  | MobileConfirmedDeletionEvent
  | MobileConfirmedFileDeletionEvent;

interface MobileOutboxEventBase {
  schemaVersion: 1;
  id: string;
  deviceId: string;
  createdAt: number;
}

export interface MobileUpsertEvent extends MobileOutboxEventBase {
  type: "upsert";
  path: string;
}

export interface MobileRenameEvent extends MobileOutboxEventBase {
  type: "rename";
  oldPath: string;
  path: string;
}

export interface MobileDeleteEvent extends MobileOutboxEventBase {
  type: "delete";
  path: string;
}

export interface MobileConfirmedDeletionEvent extends MobileOutboxEventBase {
  type: "confirm-delete";
  conflictKey: string;
  cardKey: string;
}

export interface MobileConfirmedFileDeletionEvent extends MobileOutboxEventBase {
  type: "confirm-delete-file";
  conflictKey: string;
  fileKey: string;
  path: string;
}

export interface StoredMobileOutboxEvent {
  event: MobileOutboxEvent;
  storagePath: string;
}

export interface MobileOutboxSnapshot {
  events: StoredMobileOutboxEvent[];
  invalidFiles: string[];
}

export interface MobileOutboxAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

type NewMobileOutboxEvent =
  | { type: "upsert"; path: string }
  | { type: "rename"; oldPath: string; path: string }
  | { type: "delete"; path: string }
  | { type: "confirm-delete"; conflictKey: string; cardKey: string }
  | { type: "confirm-delete-file"; conflictKey: string; fileKey: string; path: string };

export class MobileOutbox {
  constructor(
    private readonly adapter: MobileOutboxAdapter,
    private readonly directory: string,
    private readonly deviceId: string
  ) {}

  async enqueue(input: NewMobileOutboxEvent, now = Date.now()): Promise<StoredMobileOutboxEvent> {
    await this.ensureDirectory();
    await this.removeSupersededEvents(input);
    const event = {
      schemaVersion: 1 as const,
      id: createKey("event"),
      deviceId: this.deviceId,
      createdAt: now,
      ...input
    } satisfies MobileOutboxEvent;
    const storagePath = `${this.directory}/${eventFileName(event)}`;
    await this.adapter.write(storagePath, `${JSON.stringify(event, null, 2)}\n`);
    return { event, storagePath };
  }

  async snapshot(): Promise<MobileOutboxSnapshot> {
    if (!(await this.adapter.exists(this.directory))) {
      return { events: [], invalidFiles: [] };
    }
    const listed = await this.adapter.list(this.directory);
    const events: StoredMobileOutboxEvent[] = [];
    const invalidFiles: string[] = [];
    for (const storagePath of listed.files.filter((path) => path.endsWith(".json")).sort()) {
      try {
        const parsed = JSON.parse(await this.adapter.read(storagePath)) as unknown;
        if (!isMobileOutboxEvent(parsed)) {
          invalidFiles.push(storagePath);
          continue;
        }
        events.push({ event: parsed, storagePath });
      } catch {
        invalidFiles.push(storagePath);
      }
    }
    events.sort((left, right) => {
      const time = left.event.createdAt - right.event.createdAt;
      return time !== 0 ? time : left.event.id.localeCompare(right.event.id);
    });
    return { events, invalidFiles };
  }

  async remove(storagePath: string): Promise<void> {
    if (await this.adapter.exists(storagePath)) {
      await this.adapter.remove(storagePath);
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!(await this.adapter.exists(this.directory))) {
      await this.adapter.mkdir(this.directory);
    }
  }

  private async removeSupersededEvents(input: NewMobileOutboxEvent): Promise<void> {
    const snapshot = await this.snapshot();
    for (const stored of snapshot.events) {
      if (stored.event.deviceId === this.deviceId && supersededBy(input, stored.event)) {
        await this.remove(stored.storagePath);
      }
    }
  }
}

export function createDeviceId(): string {
  return createKey("device");
}

function eventFileName(event: MobileOutboxEvent): string {
  return `${event.createdAt.toString().padStart(13, "0")}-${event.deviceId}-${event.id}.json`;
}

function supersededBy(input: NewMobileOutboxEvent, existing: MobileOutboxEvent): boolean {
  if (input.type === "confirm-delete") {
    return existing.type === "confirm-delete" && existing.conflictKey === input.conflictKey;
  }
  if (input.type === "confirm-delete-file") {
    return existing.type === "confirm-delete-file" && existing.fileKey === input.fileKey;
  }
  if (input.type === "upsert") {
    return existing.type === "upsert" && existing.path === input.path;
  }
  if (input.type === "delete") {
    return (existing.type === "upsert" || existing.type === "delete") && existing.path === input.path;
  }
  return (
    existing.type === "upsert" && (existing.path === input.oldPath || existing.path === input.path)
  ) || (
    existing.type === "rename" && existing.oldPath === input.oldPath
  );
}

function isMobileOutboxEvent(value: unknown): value is MobileOutboxEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      !nonEmptyString(value.id) || !nonEmptyString(value.deviceId) ||
      typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) {
    return false;
  }
  if (value.type === "upsert" || value.type === "delete") {
    return validMarkdownPath(value.path);
  }
  if (value.type === "rename") {
    return validMarkdownPath(value.oldPath) && validMarkdownPath(value.path);
  }
  if (value.type === "confirm-delete") {
    return nonEmptyString(value.conflictKey) && nonEmptyString(value.cardKey);
  }
  if (value.type === "confirm-delete-file") {
    return nonEmptyString(value.conflictKey) && nonEmptyString(value.fileKey) && validMarkdownPath(value.path);
  }
  return false;
}

function validMarkdownPath(value: unknown): value is string {
  return nonEmptyString(value) &&
    value.toLowerCase().endsWith(".md") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
