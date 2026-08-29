import { App, Platform, PluginSettingTab, Setting } from "obsidian";
import type ObsidianAnkiBridge from "./main";
import { parseFilterEntries } from "./source-filter";

export class BridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianAnkiBridge) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Creates and updates Anki cards in the background without writing generated IDs into notes. Removed cards are deleted only after explicit confirmation."
    });

    new Setting(containerEl)
      .setName("User guide and card formats")
      .setDesc("Opens the complete guide directly inside Obsidian.")
      .addButton((button) => button.setButtonText("Open guide").onClick(() => this.plugin.showHelp()));

    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName("Mobile synchronization")
        .setDesc(
          `${this.plugin.queuedMobileActionCount} change(s) currently queued. ` +
          "No mobile connection setup is needed: the synchronized vault carries these changes to desktop Obsidian, which uses local AnkiConnect."
        );
    } else {
      new Setting(containerEl)
        .setName("AnkiConnect address")
        .setDesc("Default on Windows: http://127.0.0.1:8765")
        .addText((text) => text
          .setPlaceholder("http://127.0.0.1:8765")
          .setValue(this.plugin.bridgeSettings.ankiConnectUrl)
          .onChange(async (value) => {
            this.plugin.bridgeSettings.ankiConnectUrl = value.trim();
            await this.plugin.savePluginData();
          }));

      new Setting(containerEl)
        .setName("AnkiConnect API key")
        .setDesc("Optional; recommended when AnkiConnect requires a key.")
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(this.plugin.bridgeSettings.ankiConnectApiKey).onChange(async (value) => {
            this.plugin.bridgeSettings.ankiConnectApiKey = value;
            await this.plugin.savePluginData();
          });
        });
    }

    new Setting(containerEl)
      .setName("Anki deck root")
      .setDesc("The vault, folders, and note name are created as nested decks below this root.")
      .addText((text) => text
        .setValue(this.plugin.bridgeSettings.deckRoot)
        .onChange(async (value) => {
          this.plugin.bridgeSettings.deckRoot = value.trim() || "Obsidian Flashcards";
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("Vault name override")
      .setDesc("Leave empty to use the actual vault name.")
      .addText((text) => text
        .setValue(this.plugin.bridgeSettings.vaultNameOverride)
        .onChange(async (value) => {
          this.plugin.bridgeSettings.vaultNameOverride = value.trim();
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("Automatic synchronization")
      .setDesc("Changes are debounced and processed in the background so Obsidian remains responsive.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.bridgeSettings.autoSync)
        .onChange(async (value) => {
          this.plugin.bridgeSettings.autoSync = value;
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName("Automatic synchronization delay")
      .setDesc("Milliseconds after the most recent file change.")
      .addText((text) => text
        .setValue(String(this.plugin.bridgeSettings.autoSyncDelayMs))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed >= 250) {
            this.plugin.bridgeSettings.autoSyncDelayMs = parsed;
            await this.plugin.savePluginData();
          }
        }));

    new Setting(containerEl)
      .setName("Path audit interval")
      .setDesc("Minutes between checks for files moved outside Obsidian (minimum 5).")
      .addText((text) => text
        .setValue(String(this.plugin.bridgeSettings.pathAuditIntervalMinutes))
        .onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed >= 5) {
            this.plugin.bridgeSettings.pathAuditIntervalMinutes = parsed;
            await this.plugin.savePluginData();
          }
        }));

    containerEl.createEl("h3", { text: "Source filters" });
    containerEl.createEl("p", {
      text: "Optional filters control which Markdown notes can create or update cards. Existing Anki cards are left unchanged when a source becomes excluded. Exclusions always override included folders."
    });

    new Setting(containerEl)
      .setName("Excluded paths")
      .setDesc("One vault-relative file or folder path per line. * and ? wildcards are supported. Example: Archive or Templates/*.md")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("Archive\nTemplates/*.md")
          .setValue(this.plugin.bridgeSettings.excludedPaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.bridgeSettings.excludedPaths = parseFilterEntries(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Excluded filename patterns")
      .setDesc("One case-insensitive pattern per line. Plain text matches anywhere in the filename; * and ? are wildcards. Examples: draft, _temp*, *.canvas.md")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("draft\n_temp*\n*.canvas.md")
          .setValue(this.plugin.bridgeSettings.excludedFilenamePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.bridgeSettings.excludedFilenamePatterns = parseFilterEntries(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Included folders only")
      .setDesc("Optional allowlist: one vault-relative folder per line. When set, only notes in these folders and their subfolders are synchronized. Leave empty for the previous all-vault behavior.")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("University/Physics\nStudy notes")
          .setValue(this.plugin.bridgeSettings.includedFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.bridgeSettings.includedFolders = parseFilterEntries(value);
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Show success notices")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.bridgeSettings.showSuccessNotices)
        .onChange(async (value) => {
          this.plugin.bridgeSettings.showSuccessNotices = value;
          await this.plugin.savePluginData();
        }));

    if (!Platform.isMobile) {
      new Setting(containerEl)
        .setName("Test connection")
        .setDesc("Does not modify the Anki collection.")
        .addButton((button) => button.setButtonText("Test").onClick(() => void this.plugin.testConnection()));
    }
  }
}
