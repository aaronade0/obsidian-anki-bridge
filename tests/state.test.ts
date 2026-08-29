import { describe, expect, it } from "vitest";
import { hydratePluginData, writesSharedRegistry } from "../src/state";
import type { PluginData, PluginSettings } from "../src/types";

const defaults: PluginSettings = {
  ankiConnectUrl: "http://127.0.0.1:8765",
  ankiConnectApiKey: "",
  deckRoot: "Obsidian Flashcards",
  vaultNameOverride: "",
  autoSync: true,
  autoSyncDelayMs: 1500,
  pathAuditIntervalMinutes: 30,
  showSuccessNotices: false,
  excludedPaths: [],
  excludedFilenamePatterns: [],
  includedFolders: []
};

function partialData(deckRoot: string, key: string): Partial<PluginData> {
  return {
    settings: { ...defaults, deckRoot },
    files: [{ key: `file_${key}`, path: `${key}.md`, contentHash: key, lastSeen: 1 }],
    cards: [],
    conflicts: [],
    lastSuccessfulSyncAt: 1
  };
}

describe("device-separated plugin state", () => {
  it("uses local settings without replacing the shared registry", () => {
    const hydrated = hydratePluginData(defaults, partialData("Phone deck", "local"), partialData("Shared deck", "shared"));
    expect(hydrated.settings.deckRoot).toBe("Phone deck");
    expect(hydrated.files[0]?.path).toBe("shared.md");
  });

  it("inherits shared settings on a fresh device", () => {
    const hydrated = hydratePluginData(defaults, null, partialData("Shared deck", "shared"));
    expect(hydrated.settings.deckRoot).toBe("Shared deck");
  });

  it("allows only desktop to write the shared registry", () => {
    expect(writesSharedRegistry(false)).toBe(true);
    expect(writesSharedRegistry(true)).toBe(false);
  });
});
