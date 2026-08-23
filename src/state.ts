import type { PluginData, PluginSettings } from "./types";

export function hydratePluginData(
  defaults: PluginSettings,
  local: Partial<PluginData> | null,
  shared: Partial<PluginData> | null
): PluginData {
  const registry = shared ?? local;
  const settings = local?.settings ?? registry?.settings;
  return {
    schemaVersion: 1,
    settings: { ...defaults, ...(settings ?? {}) },
    files: Array.isArray(registry?.files) ? registry.files : [],
    cards: Array.isArray(registry?.cards) ? registry.cards : [],
    conflicts: Array.isArray(registry?.conflicts) ? registry.conflicts : [],
    lastSuccessfulSyncAt: registry?.lastSuccessfulSyncAt
  };
}

export function writesSharedRegistry(isMobile: boolean): boolean {
  return !isMobile;
}
