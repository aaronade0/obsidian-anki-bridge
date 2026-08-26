import { describe, expect, it } from "vitest";
import {
  MobileOutbox,
  type MobileOutboxAdapter
} from "../src/mobile-outbox";

class MemoryAdapter implements MobileOutboxAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return {
      files: [...this.files.keys()].filter((candidate) => candidate.startsWith(prefix)),
      folders: [...this.folders].filter((candidate) => candidate.startsWith(prefix))
    };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`Missing test file: ${path}`);
    }
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

describe("mobile outbox", () => {
  it("stores independent device events in deterministic processing order", async () => {
    const adapter = new MemoryAdapter();
    const firstDevice = new MobileOutbox(adapter, ".obsidian/plugins/obsidian-anki-bridge/outbox", "device_a");
    const secondDevice = new MobileOutbox(adapter, ".obsidian/plugins/obsidian-anki-bridge/outbox", "device_b");

    await secondDevice.enqueue({ type: "delete", path: "Later.md" }, 20);
    await firstDevice.enqueue({ type: "upsert", path: "Earlier.md" }, 10);
    const snapshot = await firstDevice.snapshot();

    expect(snapshot.invalidFiles).toEqual([]);
    expect(snapshot.events.map(({ event }) => [event.type, "path" in event ? event.path : undefined])).toEqual([
      ["upsert", "Earlier.md"],
      ["delete", "Later.md"]
    ]);
    expect(new Set(snapshot.events.map(({ event }) => event.deviceId))).toEqual(new Set(["device_a", "device_b"]));
  });

  it("preserves invalid files for diagnosis and removes only acknowledged events", async () => {
    const adapter = new MemoryAdapter();
    const directory = ".obsidian/plugins/obsidian-anki-bridge/outbox";
    const outbox = new MobileOutbox(adapter, directory, "device_a");
    const stored = await outbox.enqueue({
      type: "rename",
      oldPath: "Before.md",
      path: "After.md"
    }, 10);
    adapter.files.set(`${directory}/broken.json`, "{not json");

    const first = await outbox.snapshot();
    expect(first.events).toHaveLength(1);
    expect(first.invalidFiles).toEqual([`${directory}/broken.json`]);

    await outbox.remove(stored.storagePath);
    const second = await outbox.snapshot();
    expect(second.events).toEqual([]);
    expect(second.invalidFiles).toEqual([`${directory}/broken.json`]);
  });

  it("coalesces repeated changes from one device without removing another device's work", async () => {
    const adapter = new MemoryAdapter();
    const directory = ".obsidian/plugins/obsidian-anki-bridge/outbox";
    const firstDevice = new MobileOutbox(adapter, directory, "device_a");
    const secondDevice = new MobileOutbox(adapter, directory, "device_b");
    await firstDevice.enqueue({ type: "upsert", path: "Note.md" }, 1);
    await secondDevice.enqueue({ type: "upsert", path: "Note.md" }, 2);
    await firstDevice.enqueue({ type: "upsert", path: "Note.md" }, 3);

    const snapshot = await firstDevice.snapshot();
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.map(({ event }) => [event.deviceId, event.createdAt])).toEqual([
      ["device_b", 2],
      ["device_a", 3]
    ]);
  });

  it("queues and coalesces a confirmed whole-file deletion", async () => {
    const adapter = new MemoryAdapter();
    const directory = ".obsidian/plugins/obsidian-anki-bridge/outbox";
    const outbox = new MobileOutbox(adapter, directory, "device_a");
    await outbox.enqueue({
      type: "confirm-delete-file",
      conflictKey: "conflict_first",
      fileKey: "file_source",
      path: "Deleted note.md"
    }, 1);
    await outbox.enqueue({
      type: "confirm-delete-file",
      conflictKey: "conflict_latest",
      fileKey: "file_source",
      path: "Deleted note.md"
    }, 2);

    const snapshot = await outbox.snapshot();
    expect(snapshot.invalidFiles).toEqual([]);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.event).toMatchObject({
      type: "confirm-delete-file",
      conflictKey: "conflict_latest",
      fileKey: "file_source",
      path: "Deleted note.md"
    });
  });

  it("rejects malformed or non-Markdown operations", async () => {
    const adapter = new MemoryAdapter();
    const directory = ".obsidian/plugins/obsidian-anki-bridge/outbox";
    adapter.folders.add(directory);
    adapter.files.set(`${directory}/bad-path.json`, JSON.stringify({
      schemaVersion: 1,
      id: "event_bad",
      deviceId: "device_a",
      createdAt: 1,
      type: "upsert",
      path: "Attachment.png"
    }));
    adapter.files.set(`${directory}/traversal.json`, JSON.stringify({
      schemaVersion: 1,
      id: "event_traversal",
      deviceId: "device_a",
      createdAt: 2,
      type: "delete",
      path: "../Outside.md"
    }));
    adapter.files.set(`${directory}/bad-confirmation.json`, JSON.stringify({
      schemaVersion: 1,
      id: "event_bad_confirmation",
      deviceId: "device_a",
      createdAt: 3,
      type: "confirm-delete-file",
      conflictKey: "conflict_a",
      fileKey: "file_a",
      path: "Attachment.png"
    }));
    const outbox = new MobileOutbox(adapter, directory, "device_a");

    const snapshot = await outbox.snapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.invalidFiles).toEqual([
      `${directory}/bad-confirmation.json`,
      `${directory}/bad-path.json`,
      `${directory}/traversal.json`
    ]);
  });
});
