import {
  Editor,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Platform,
  Plugin,
  type TAbstractFile,
  TFile,
  TFolder,
  setIcon
} from "obsidian";
import {
  IMAGE_OCCLUSION_MODEL,
  STANDARD_MODEL,
  AnkiConnectClient
} from "./anki-connect";
import { deriveDeckName } from "./deck";
import { buildDesiredNotes } from "./desired-notes";
import { createEditorExtensions, openCardTypeModal } from "./editor";
import { cardTemplateChoice, insertCardTemplate } from "./card-templates";
import { stableHash } from "./hash";
import {
  DUMP_END_MARKER,
  DUMP_START_MARKER,
  FlashcardParser,
  LIST_END_MARKER,
  LIST_START_MARKER
} from "./parser";
import { moveRegistryFile, reconcileFile } from "./registry";
import { noteBelongsToCardKey } from "./ownership";
import {
  MobileOutbox,
  createDeviceId,
  type StoredMobileOutboxEvent
} from "./mobile-outbox";
import { BridgeSettingTab } from "./settings";
import type {
  DesiredAnkiNote,
  PluginData,
  PluginSettings,
  RegistryCard,
  RegistryChild,
  SyncConflict,
  SyncSummary
} from "./types";
import { ObsidianVisualRenderer } from "./visual-renderer";
import README_MARKDOWN from "../README.md";

const DEFAULT_SETTINGS: PluginSettings = {
  ankiConnectUrl: "http://127.0.0.1:8765",
  ankiConnectApiKey: "",
  deckRoot: "Obsidian Flashcards",
  vaultNameOverride: "",
  autoSync: true,
  autoSyncDelayMs: 1500,
  pathAuditIntervalMinutes: 30,
  showSuccessNotices: false
};

const DEVICE_ID_STORAGE_KEY = "obsidian-anki-bridge-device-id";
const MOBILE_OUTBOX_POLL_INTERVAL_MS = 30_000;

export default class ObsidianAnkiBridge extends Plugin {
  data: PluginData = emptyData();
  readonly parser = new FlashcardParser();
  private statusEl!: HTMLElement;
  private readonly pendingTimers = new Map<string, number>();
  private readonly activeSyncs = new Map<string, Promise<SyncSummary | undefined>>();
  private readonly explicitDeletionPaths = new Set<string>();
  private readonly deletionIntentTimers = new Map<string, number>();
  private modelsSignature = "";
  private lastFailureNoticeAt = 0;
  private visualRenderer!: ObsidianVisualRenderer;
  private mobileOutbox!: MobileOutbox;
  private queuedMobileActions = 0;
  private processingMobileOutbox?: Promise<void>;

  get bridgeSettings(): PluginSettings {
    return this.data.settings;
  }

  get queuedMobileActionCount(): number {
    return this.queuedMobileActions;
  }

  async onload(): Promise<void> {
    await this.loadPluginData();
    const storedDeviceId = this.app.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
    const deviceId = typeof storedDeviceId === "string" && storedDeviceId.startsWith("device_")
      ? storedDeviceId
      : createDeviceId();
    if (deviceId !== storedDeviceId) {
      this.app.saveLocalStorage(DEVICE_ID_STORAGE_KEY, deviceId);
    }
    const pluginDirectory = this.manifest.dir ?? ".obsidian/plugins/obsidian-anki-bridge";
    this.mobileOutbox = new MobileOutbox(
      this.app.vault.adapter,
      `${pluginDirectory}/mobile-outbox`,
      deviceId
    );
    await this.refreshMobileOutboxCount();
    this.visualRenderer = new ObsidianVisualRenderer(
      this.app,
      this.manifest.dir ?? ".obsidian/plugins/obsidian-anki-bridge"
    );
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("oab-status");
    this.statusEl.addEventListener("click", () => this.showConflictReport());
    this.updateStatus();

    this.addSettingTab(new BridgeSettingTab(this.app, this));
    this.registerEditorExtension(createEditorExtensions(this.app, this.parser));
    this.addRibbonIcon("plus-circle", "Insert Anki flashcard", () => this.openCardTypePicker());
    this.addRibbonIcon("refresh-cw", "Sync Obsidian flashcards", () => void this.syncCurrentFile(true));
    this.addRibbonIcon("book-open", "Obsidian Anki Bridge – Open user guide", () => this.showHelp());
    this.registerCommands();
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      menu.addItem((item) => item
        .setTitle("Insert Anki flashcard …")
        .setIcon("plus-circle")
        .onClick(() => openCardTypeModal(this.app, editor)));
    }));
    this.installDeletionOriginTracking();

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      const registered = this.data.files.find((candidate) => candidate.path === file.path);
      const restoring = registered !== undefined && (
        registered.missingReason !== undefined ||
        this.data.cards.some((candidate) => candidate.fileKey === registered.key && candidate.status === "missing")
      );
      if (Platform.isMobile && (restoring || this.bridgeSettings.autoSync)) {
        this.scheduleSync(file);
      } else if (restoring) {
        void this.syncFileGuarded(file, false);
      } else if (this.bridgeSettings.autoSync) {
        this.scheduleSync(file);
      }
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md" && this.bridgeSettings.autoSync) {
        this.scheduleSync(file);
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        if (Platform.isMobile) {
          void this.queueMobileRename(file, oldPath);
        } else {
          void this.handleRename(file, oldPath);
        }
      } else if (file instanceof TFolder) {
        if (Platform.isMobile) {
          void this.queueMobileFolderRename(file.path, oldPath);
        } else {
          void this.handleFolderRename(file.path, oldPath);
        }
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        const explicitlyDeletedInObsidian = this.consumeDeletionIntent(file.path);
        if (Platform.isMobile) {
          if (explicitlyDeletedInObsidian) {
            void this.queueMobileDelete(file.path);
          }
        } else {
          void this.handleDelete(file.path, explicitlyDeletedInObsidian);
        }
      }
    }));

    this.registerObsidianProtocolHandler("anki-bridge", (params) => void this.openSourceCard(params.card));
    this.app.workspace.onLayoutReady(() => {
      if (Platform.isMobile) {
        void this.refreshMobileOutboxCount();
      } else {
        void this.runDesktopCatchUp();
      }
    });
    if (!Platform.isMobile) {
      this.registerInterval(window.setInterval(
        () => void this.auditMovedFiles(),
        Math.max(5, this.bridgeSettings.pathAuditIntervalMinutes) * 60_000
      ));
      this.registerInterval(window.setInterval(
        () => void this.processMobileOutbox(),
        MOBILE_OUTBOX_POLL_INTERVAL_MS
      ));
    }
  }

  onunload(): void {
    for (const timer of this.pendingTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pendingTimers.clear();
    for (const timer of this.deletionIntentTimers.values()) {
      window.clearTimeout(timer);
    }
    this.deletionIntentTimers.clear();
    this.explicitDeletionPaths.clear();
  }

  async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginData> | null;
    this.data = {
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
      files: Array.isArray(raw?.files) ? raw.files : [],
      cards: Array.isArray(raw?.cards) ? raw.cards : [],
      conflicts: Array.isArray(raw?.conflicts) ? raw.conflicts : [],
      lastSuccessfulSyncAt: raw?.lastSuccessfulSyncAt
    };
    for (const card of this.data.cards) {
      card.children ??= [];
      for (const child of card.children) {
        child.status ??= "active";
      }
    }
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
    this.updateStatus();
  }

  async testConnection(): Promise<void> {
    if (Platform.isMobile) {
      new Notice(
        "Mobile changes are queued in the synchronized vault and sent through desktop AnkiConnect when Obsidian and Anki are next open on a computer.",
        12_000
      );
      return;
    }
    try {
      const version = await this.client().ping();
      new Notice(`AnkiConnect is available (API version ${version}).`);
      this.resolveConflict("ANKI_UNREACHABLE");
      await this.savePluginData();
    } catch (error) {
      this.recordConflict("ANKI_UNREACHABLE", errorMessage(error));
      await this.savePluginData();
      new Notice(`Obsidian Anki Bridge: ${errorMessage(error)}`, 12_000);
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "insert-flashcard",
      name: "Insert flashcard …",
      icon: "plus-circle",
      editorCallback: (editor) => openCardTypeModal(this.app, editor)
    });
    this.addCommand({
      id: "sync-current-note",
      name: "Sync current note with Anki",
      callback: () => void this.syncCurrentFile(true)
    });
    this.addCommand({
      id: "sync-all-notes",
      name: "Sync all new flashcards",
      callback: () => void this.syncAllFiles()
    });
    this.addCommand({
      id: "show-conflicts",
      name: "Show conflicts and pending deletions",
      callback: () => this.showConflictReport()
    });
    this.addCommand({
      id: "show-help",
      name: "Open user guide",
      callback: () => this.showHelp()
    });
    this.addCommand({
      id: "audit-moved-notes",
      name: "Find notes moved outside Obsidian",
      callback: () => void this.auditMovedFiles(true)
    });
    this.addCommand({
      id: "open-current-card-in-anki",
      name: "Open card at cursor in Anki",
      editorCallback: (editor) => void this.openCardAtCursor(editor)
    });
    this.addCommand({
      id: "insert-basic-card",
      name: "Insert basic card",
      icon: "arrow-right",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("basic"))
    });
    this.addCommand({
      id: "insert-reverse-card",
      name: "Insert reversible card",
      icon: "arrow-left-right",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("reverse"))
    });
    this.addCommand({
      id: "insert-list-card",
      name: "Insert list card",
      icon: "list",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("list"))
    });
    this.addCommand({
      id: "insert-dump-card",
      name: "Insert dump card",
      icon: "align-left",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("dump"))
    });
    this.addCommand({
      id: "insert-image-card",
      name: "Insert Image Occlusion card",
      icon: "image",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("image"))
    });
    this.addCommand({
      id: "insert-cloze",
      name: "Mark selection as cloze deletion",
      icon: "brackets",
      editorCallback: (editor) => insertCardTemplate(editor, cardTemplateChoice("cloze"))
    });
  }

  private openCardTypePicker(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a Markdown note before inserting an Anki flashcard.");
      return;
    }
    openCardTypeModal(this.app, view.editor);
  }

  private installDeletionOriginTracking(): void {
    const fileManager = this.app.fileManager;
    const originalTrashFile = fileManager.trashFile;
    const wrappedTrashFile = async (file: TAbstractFile): Promise<void> => {
      const paths = this.registerDeletionIntent(file);
      try {
        await originalTrashFile.call(fileManager, file);
      } catch (error) {
        for (const path of paths) {
          this.clearDeletionIntent(path);
        }
        throw error;
      }
      for (const path of paths) {
        this.expireDeletionIntent(path);
      }
    };
    fileManager.trashFile = wrappedTrashFile;
    this.register(() => {
      if (fileManager.trashFile === wrappedTrashFile) {
        fileManager.trashFile = originalTrashFile;
      }
    });
  }

  private registerDeletionIntent(file: TAbstractFile): string[] {
    const paths = file instanceof TFile
      ? file.extension === "md" && this.data.files.some((candidate) => candidate.path === file.path)
        ? [file.path]
        : []
      : this.data.files
          .filter((candidate) => candidate.path.startsWith(`${file.path}/`))
          .map((candidate) => candidate.path);
    for (const path of paths) {
      const timer = this.deletionIntentTimers.get(path);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        this.deletionIntentTimers.delete(path);
      }
      this.explicitDeletionPaths.add(path);
    }
    return paths;
  }

  private expireDeletionIntent(path: string): void {
    const timer = window.setTimeout(() => this.clearDeletionIntent(path), 10_000);
    this.deletionIntentTimers.set(path, timer);
  }

  private consumeDeletionIntent(path: string): boolean {
    const explicit = this.explicitDeletionPaths.has(path);
    this.clearDeletionIntent(path);
    return explicit;
  }

  private clearDeletionIntent(path: string): void {
    this.explicitDeletionPaths.delete(path);
    const timer = this.deletionIntentTimers.get(path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.deletionIntentTimers.delete(path);
    }
  }

  private scheduleSync(file: TFile): void {
    const previous = this.pendingTimers.get(file.path);
    if (previous !== undefined) {
      window.clearTimeout(previous);
    }
    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(file.path);
      if (Platform.isMobile) {
        void this.queueMobileUpsert(file, false);
      } else {
        void this.syncFileGuarded(file, false);
      }
    }, this.bridgeSettings.autoSyncDelayMs);
    this.pendingTimers.set(file.path, timer);
  }

  private async queueMobileUpsert(file: TFile, manual: boolean): Promise<void> {
    try {
      const source = await this.app.vault.cachedRead(file);
      const registered = this.data.files.some((candidate) => candidate.path === file.path);
      if (!registered && !containsCanonicalMarker(source)) {
        if (manual) {
          new Notice("No Obsidian Anki cards were found in this note.");
        }
        return;
      }
      await this.mobileOutbox.enqueue({ type: "upsert", path: file.path });
      await this.refreshMobileOutboxCount();
      if (manual) {
        new Notice(
          "This note is queued. It will synchronize through local AnkiConnect when desktop Obsidian and Anki are next open.",
          10_000
        );
      }
    } catch (error) {
      new Notice(
        `The mobile change could not be written to the synchronized outbox: ${errorMessage(error)}`,
        12_000
      );
    }
  }

  private async queueMobileRename(file: TFile, oldPath: string): Promise<void> {
    this.clearPendingSync(oldPath);
    try {
      await this.mobileOutbox.enqueue({ type: "rename", oldPath, path: file.path });
      await this.refreshMobileOutboxCount();
    } catch (error) {
      new Notice(`The mobile rename could not be queued: ${errorMessage(error)}`, 12_000);
    }
  }

  private async queueMobileFolderRename(newFolderPath: string, oldFolderPath: string): Promise<void> {
    try {
      const registeredPaths = this.data.files
        .map((file) => file.path)
        .filter((path) => path.startsWith(`${oldFolderPath}/`));
      for (const oldPath of registeredPaths) {
        this.clearPendingSync(oldPath);
        const path = `${newFolderPath}/${oldPath.slice(oldFolderPath.length + 1)}`;
        await this.mobileOutbox.enqueue({ type: "rename", oldPath, path });
      }
      await this.refreshMobileOutboxCount();
    } catch (error) {
      new Notice(`The mobile folder rename could not be queued: ${errorMessage(error)}`, 12_000);
    }
  }

  private async queueMobileDelete(path: string): Promise<void> {
    this.clearPendingSync(path);
    try {
      await this.mobileOutbox.enqueue({ type: "delete", path });
      await this.refreshMobileOutboxCount();
      new Notice(
        "The note deletion is queued. Its cards will appear as pending deletions after desktop processing; nothing is deleted from Anki automatically.",
        10_000
      );
    } catch (error) {
      new Notice(`The mobile deletion could not be queued: ${errorMessage(error)}`, 12_000);
    }
  }

  private clearPendingSync(path: string): void {
    const timer = this.pendingTimers.get(path);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingTimers.delete(path);
    }
  }

  private async refreshMobileOutboxCount(): Promise<void> {
    const snapshot = await this.mobileOutbox.snapshot();
    this.queuedMobileActions = snapshot.events.length;
    this.updateStatus();
  }

  private async runDesktopCatchUp(): Promise<void> {
    await this.processMobileOutbox();
    await this.syncFilesChangedWhileClosed();
    await this.auditMovedFiles();
  }

  private async syncFilesChangedWhileClosed(): Promise<void> {
    if (!this.bridgeSettings.autoSync) {
      return;
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.cachedRead(file);
      const registered = this.data.files.find((candidate) => candidate.path === file.path);
      const needsSync = registered
        ? registered.contentHash !== stableHash(source)
        : containsCanonicalMarker(source);
      if (needsSync) {
        await this.syncFileGuarded(file, false);
        await yieldToUi();
      }
    }
  }

  async processMobileOutbox(): Promise<void> {
    if (Platform.isMobile) {
      await this.refreshMobileOutboxCount();
      return;
    }
    if (this.processingMobileOutbox) {
      return this.processingMobileOutbox;
    }
    const run = this.processMobileOutboxNow().catch(async (error) => {
      this.recordConflict(
        "MOBILE_OUTBOX_UNAVAILABLE",
        `The synchronized mobile outbox could not be read: ${errorMessage(error)}`
      );
      await this.savePluginData();
    }).finally(() => {
      this.processingMobileOutbox = undefined;
    });
    this.processingMobileOutbox = run;
    return run;
  }

  private async processMobileOutboxNow(): Promise<void> {
    const snapshot = await this.mobileOutbox.snapshot();
    const hadUnavailableConflict = this.data.conflicts.some((conflict) =>
      conflict.code === "MOBILE_OUTBOX_UNAVAILABLE" && conflict.resolvedAt === undefined
    );
    this.resolveConflict("MOBILE_OUTBOX_UNAVAILABLE");
    const invalidPaths = new Set(snapshot.invalidFiles);
    let invalidConflictChanged = false;
    for (const conflict of this.data.conflicts) {
      if (conflict.code === "MOBILE_OUTBOX_INVALID" && conflict.resolvedAt === undefined &&
          conflict.path && !invalidPaths.has(conflict.path)) {
        conflict.resolvedAt = Date.now();
        invalidConflictChanged = true;
      }
    }
    for (const invalidPath of snapshot.invalidFiles) {
      this.recordConflict(
        "MOBILE_OUTBOX_INVALID",
        "A mobile outbox entry is invalid and was preserved for diagnosis instead of being executed.",
        invalidPath
      );
      invalidConflictChanged = true;
    }
    if (invalidConflictChanged || hadUnavailableConflict) {
      await this.savePluginData();
    }

    for (const [index, stored] of snapshot.events.entries()) {
      try {
        const handled = await this.processMobileOutboxEvent(stored, snapshot.events.slice(index + 1));
        if (!handled) {
          continue;
        }
        await this.mobileOutbox.remove(stored.storagePath);
        const hadProcessingConflict = this.data.conflicts.some((conflict) =>
          conflict.code === "MOBILE_OUTBOX_FAILED" &&
          conflict.path === stored.storagePath &&
          conflict.resolvedAt === undefined
        );
        this.resolveConflict("MOBILE_OUTBOX_FAILED", stored.storagePath);
        if (hadProcessingConflict) {
          await this.savePluginData();
        }
      } catch (error) {
        this.recordConflict(
          "MOBILE_OUTBOX_FAILED",
          `A queued mobile change could not yet be processed: ${errorMessage(error)}`,
          stored.storagePath
        );
        await this.savePluginData();
      }
    }
    await this.refreshMobileOutboxCount();
  }

  private async processMobileOutboxEvent(
    stored: StoredMobileOutboxEvent,
    laterEvents: StoredMobileOutboxEvent[]
  ): Promise<boolean> {
    const { event } = stored;
    if (event.type === "upsert") {
      const file = this.app.vault.getAbstractFileByPath(event.path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        return laterEvents.some(({ event: later }) =>
          later.type === "delete" && later.path === event.path ||
          later.type === "rename" && later.oldPath === event.path
        );
      }
      return (await this.syncFileGuarded(file, false)) !== undefined;
    }

    if (event.type === "rename") {
      const file = this.app.vault.getAbstractFileByPath(event.path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        const superseded = laterEvents.some(({ event: later }) =>
          later.type === "delete" && later.path === event.path ||
          later.type === "rename" && later.oldPath === event.path
        );
        if (superseded) {
          const registered = this.data.files.find((candidate) => candidate.path === event.oldPath);
          if (registered) {
            moveRegistryFile(registered, this.data.cards, event.path);
            await this.savePluginData();
          }
        }
        return superseded;
      }
      const registered = this.data.files.find((candidate) => candidate.path === event.oldPath);
      if (registered) {
        moveRegistryFile(registered, this.data.cards, event.path);
        this.resolveConflict("FILE_MISSING", event.oldPath);
        this.resolveConflict("FILE_MOVE_AMBIGUOUS", event.oldPath);
        await this.savePluginData();
      }
      return (await this.syncFileGuarded(file, false)) !== undefined;
    }

    if (event.type === "delete") {
      await this.handleDelete(event.path, true);
      return true;
    }

    const conflict = this.data.conflicts.find((candidate) =>
      candidate.key === event.conflictKey &&
      candidate.cardKey === event.cardKey &&
      candidate.resolvedAt === undefined &&
      isRemovalConflict(candidate)
    );
    const target = conflict ? findRegistryTarget(this.data.cards, event.cardKey) : undefined;
    const stillMissing = target?.child ? target.child.status === "missing" : target?.card.status === "missing";
    if (!conflict || !target || !stillMissing) {
      return true;
    }
    await this.deleteRemovedCard(event.conflictKey);
    return true;
  }

  private async syncCurrentFile(manual: boolean): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("No Markdown note is open.");
      return;
    }
    if (Platform.isMobile) {
      await this.queueMobileUpsert(file, manual);
      return;
    }
    await this.syncFileGuarded(file, manual);
  }

  private async syncAllFiles(): Promise<void> {
    if (Platform.isMobile) {
      let queued = 0;
      for (const file of this.app.vault.getMarkdownFiles()) {
        const registered = this.data.files.some((candidate) => candidate.path === file.path);
        const source = await this.app.vault.cachedRead(file);
        if (!registered && !containsCanonicalMarker(source)) {
          continue;
        }
        await this.queueMobileUpsert(file, false);
        queued += 1;
        await yieldToUi();
      }
      new Notice(
        `Obsidian Anki Bridge: ${queued} note(s) queued for desktop Anki synchronization.`,
        10_000
      );
      return;
    }
    new Notice("Obsidian Anki Bridge: Background synchronization started.");
    let synced = 0;
    let failed = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const registered = this.data.files.some((candidate) => candidate.path === file.path);
      const source = await this.app.vault.cachedRead(file);
      if (!registered && !containsCanonicalMarker(source)) {
        continue;
      }
      const result = await this.syncFileGuarded(file, false);
      result ? synced += 1 : failed += 1;
      await yieldToUi();
    }
    new Notice(`Obsidian Anki Bridge: ${synced} notes synchronized, ${failed} failed.`, 10_000);
  }

  private async syncFileGuarded(file: TFile, manual: boolean): Promise<SyncSummary | undefined> {
    if (Platform.isMobile) {
      await this.queueMobileUpsert(file, manual);
      return emptySummary(file.path);
    }
    const current = this.activeSyncs.get(file.path);
    if (current) {
      return current;
    }
    const run = this.syncFile(file, manual).catch(async (error: unknown) => {
      const message = errorMessage(error);
      this.recordConflict("SYNC_FAILED", message, file.path);
      await this.savePluginData();
      const now = Date.now();
      if (manual || now - this.lastFailureNoticeAt > 5 * 60_000) {
        this.lastFailureNoticeAt = now;
        new Notice(`Anki synchronization failed: ${message}\nThe error remains visible in the conflict report.`, 15_000);
      }
      return undefined;
    }).finally(() => this.activeSyncs.delete(file.path));
    this.activeSyncs.set(file.path, run);
    return run;
  }

  private async syncFile(file: TFile, manual: boolean): Promise<SyncSummary> {
    const source = await this.app.vault.cachedRead(file);
    if (!containsCanonicalMarker(source) && !this.data.files.some((candidate) => candidate.path === file.path)) {
      if (manual) {
        new Notice("No new Obsidian Anki cards were found in this note.");
      }
      return emptySummary(file.path);
    }

    const parsed = this.parser.parse(source);
    const reconciled = reconcileFile(file.path, source, parsed, this.data.files, this.data.cards);
    this.resolveConflict("FILE_MISSING", file.path);
    this.resolveConflict("FILE_MOVE_AMBIGUOUS", file.path);
    this.resolveConflict("INVALID_BLOCK", file.path);
    this.resolveConflict("NESTED_CARD_IGNORED", file.path);
    for (const warning of syntaxWarnings(source, parsed)) {
      this.recordConflict(warning.code, warning.message, file.path, warning.cardKey, "warning");
    }
    for (const missing of reconciled.missingCards) {
      this.recordConflict(
        "CARD_REMOVED",
        "This card was removed from the Obsidian note. It remains in Anki until deletion is confirmed here.",
        file.path,
        missing.key,
        "warning"
      );
    }
    for (const active of reconciled.activeCards) {
      this.resolveConflict("CARD_REMOVED", file.path, active.key);
      for (const child of active.children.filter((candidate) => candidate.status === "missing" && candidate.ankiNoteId)) {
        this.recordConflict(
          "LIST_ITEM_REMOVED",
          "This list item was removed from the Obsidian note. It remains in Anki until deletion is confirmed here.",
          file.path,
          child.key,
          "warning"
        );
      }
    }

    if (parsed.length === 0) {
      await this.savePluginData();
      if (manual) {
        new Notice("No active cards found; previous cards were only marked as missing.", 10_000);
      }
      return { ...emptySummary(file.path), conflicts: reconciled.missingCards.length };
    }

    const client = this.client();
    await client.ping();
    const signature = `${this.bridgeSettings.ankiConnectUrl}\u241f${this.bridgeSettings.ankiConnectApiKey}`;
    if (this.modelsSignature !== signature) {
      await client.ensureModels();
      this.modelsSignature = signature;
    }
    const vaultName = this.bridgeSettings.vaultNameOverride || this.app.vault.getName();
    const deckName = deriveDeckName(this.bridgeSettings.deckRoot, vaultName, file.path);
    await client.ensureDeck(deckName);
    const desired = await buildDesiredNotes(
      this.app,
      client,
      vaultName,
      file.path,
      deckName,
      parsed,
      reconciled.activeCards,
      this.visualRenderer
    );

    this.resolveConflict("RENDER_WARNING", file.path);
    for (const warning of desired.warnings) {
      this.recordConflict("RENDER_WARNING", warning.message, file.path, warning.cardKey, "warning");
    }

    const imageNotes = desired.notes.filter((note) => note.modelName === IMAGE_OCCLUSION_MODEL);
    let imageOcclusionReady = true;
    if (imageNotes.length > 0) {
      try {
        await client.assertImageOcclusionModel();
        for (const note of imageNotes) {
          this.resolveConflict("IMAGE_OCCLUSION_MODEL_MISSING", file.path, note.cardKey);
        }
      } catch (error) {
        imageOcclusionReady = false;
        for (const note of imageNotes) {
          this.recordConflict(
            "IMAGE_OCCLUSION_MODEL_MISSING",
            errorMessage(error),
            file.path,
            note.cardKey
          );
        }
      }
    }

    let createdNotes = 0;
    let updatedNotes = 0;
    let movedCards = 0;
    for (const note of desired.notes) {
      if (note.modelName === IMAGE_OCCLUSION_MODEL && !imageOcclusionReady) {
        continue;
      }
      let noteId = note.existingNoteId;
      let existingInfo = noteId === undefined ? undefined : await client.noteInfo(noteId);
      if (noteId !== undefined && !existingInfo) {
        noteId = undefined;
      }
      noteId ??= await client.findNoteByCardKey(note.cardKey);
      existingInfo = noteId === undefined ? undefined : await client.noteInfo(noteId);
      if (existingInfo && !noteBelongsToCardKey(existingInfo, note.cardKey)) {
        this.recordConflict(
          "ANKI_OWNERSHIP_MISMATCH",
          "The stored Anki mapping points to a note without this bridge card's ownership field or tag. It was left unchanged.",
          file.path,
          note.cardKey
        );
        continue;
      }
      if (noteId === undefined) {
        noteId = await client.addNote(note);
        createdNotes += 1;
      } else if (existingInfo?.modelName !== note.modelName) {
        if (note.modelName === IMAGE_OCCLUSION_MODEL && existingInfo?.modelName === STANDARD_MODEL) {
          try {
            await client.migrateNoteModel(noteId, note, existingInfo.tags);
            const migrated = await client.noteInfo(noteId);
            if (!migrated || migrated.modelName !== IMAGE_OCCLUSION_MODEL || !noteBelongsToCardKey(migrated, note.cardKey)) {
              throw new Error("Anki did not apply or verify the native Image Occlusion migration.");
            }
            updatedNotes += 1;
            this.resolveConflict("ANKI_MODEL_MIGRATION_REQUIRED", file.path, note.cardKey);
          } catch (error) {
            this.recordConflict(
              "ANKI_MODEL_MIGRATION_REQUIRED",
              errorMessage(error),
              file.path,
              note.cardKey
            );
            continue;
          }
        } else {
          this.recordConflict(
            "ANKI_MODEL_MISMATCH",
            `The mapped Anki note uses “${existingInfo?.modelName ?? "unknown"}” instead of “${note.modelName}”. It was left unchanged.`,
            file.path,
            note.cardKey
          );
          continue;
        }
      } else {
        await client.updateNote(noteId, pickFields(note.fields, note.ownedFields), note.tags);
        updatedNotes += 1;
        this.resolveConflict("ANKI_MODEL_MIGRATION_REQUIRED", file.path, note.cardKey);
      }
      this.resolveConflict("ANKI_MODEL_MISMATCH", file.path, note.cardKey);
      this.resolveConflict("ANKI_OWNERSHIP_MISMATCH", file.path, note.cardKey);
      if (await client.moveNoteToDeck(noteId, note.deckName)) {
        movedCards += 1;
      }
      this.assignNoteId(note, noteId);
      this.resolveConflict("LIST_ITEM_REMOVED", file.path, note.cardKey);
    }

    this.resolveConflict("SYNC_FAILED", file.path);
    this.resolveConflict("ANKI_UNREACHABLE");
    this.data.lastSuccessfulSyncAt = Date.now();
    await this.savePluginData();
    const summary: SyncSummary = {
      path: file.path,
      parsedCards: parsed.length,
      desiredNotes: desired.notes.length,
      createdNotes,
      updatedNotes,
      movedCards,
      conflicts: unresolvedConflicts(this.data.conflicts).filter((conflict) => conflict.path === file.path).length
    };
    if (manual || this.bridgeSettings.showSuccessNotices) {
      new Notice(
        `Anki: ${createdNotes} created, ${updatedNotes} updated, ${movedCards} moved` +
        (summary.conflicts > 0 ? `, ${summary.conflicts} warning(s)` : "."),
        8_000
      );
    }
    return summary;
  }

  private assignNoteId(note: DesiredAnkiNote, noteId: number): void {
    const parent = this.data.cards.find((card) => card.key === note.parentCardKey);
    if (!parent) {
      return;
    }
    if (note.cardKey === parent.key) {
      parent.ankiNoteId = noteId;
      return;
    }
    const child = parent.children.find((candidate) => candidate.key === note.cardKey);
    if (child) {
      child.ankiNoteId = noteId;
    }
  }

  private async handleRename(file: TFile, oldPath: string): Promise<void> {
    const registered = this.data.files.find((candidate) => candidate.path === oldPath);
    if (!registered) {
      return;
    }
    moveRegistryFile(registered, this.data.cards, file.path);
    this.resolveConflict("FILE_MISSING", oldPath);
    await this.savePluginData();
    await this.syncFileGuarded(file, false);
  }

  private async handleFolderRename(newFolderPath: string, oldFolderPath: string): Promise<void> {
    const registeredPaths = this.data.files
      .map((file) => file.path)
      .filter((path) => path.startsWith(`${oldFolderPath}/`));
    for (const oldPath of registeredPaths) {
      const path = `${newFolderPath}/${oldPath.slice(oldFolderPath.length + 1)}`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && file.extension === "md") {
        await this.handleRename(file, oldPath);
        await yieldToUi();
      }
    }
  }

  private async handleDelete(path: string, explicitlyDeletedInObsidian: boolean): Promise<void> {
    const registered = this.data.files.find((candidate) => candidate.path === path);
    if (!registered) {
      return;
    }
    const cards = this.data.cards.filter((candidate) => candidate.fileKey === registered.key);
    for (const card of cards) {
      card.status = "missing";
      for (const child of card.children) {
        child.status = "missing";
      }
    }
    registered.lastSeen = Date.now();

    if (explicitlyDeletedInObsidian) {
      registered.missingReason = "deleted-in-obsidian";
      this.resolveConflict("FILE_MISSING", path);
      this.resolveConflict("FILE_MOVE_AMBIGUOUS", path);
      for (const card of cards) {
        for (const child of card.children) {
          this.resolveConflict("LIST_ITEM_REMOVED", path, child.key);
        }
        this.recordConflict(
          "CARD_REMOVED",
          "The source note was deleted in Obsidian. This card remains in Anki until deletion is confirmed here.",
          path,
          card.key,
          "warning"
        );
      }
      if (cards.length === 0) {
        this.data.files = this.data.files.filter((candidate) => candidate.key !== registered.key);
      }
      await this.savePluginData();
      new Notice(
        cards.length === 0
          ? "Obsidian Anki Bridge: The deleted note had no registered cards."
          : `Obsidian Anki Bridge: ${cards.length} card(s) await deletion confirmation.`,
        10_000
      );
      return;
    }

    registered.missingReason = "unknown";
    this.recordConflict(
      "FILE_MISSING",
      "The source note disappeared without a confirmed Obsidian deletion. It may have been moved or deleted externally. Its Anki cards were kept, and the periodic path audit will look for it.",
      path
    );
    await this.savePluginData();
    new Notice("Obsidian Anki Bridge: A note may have been moved or deleted; its cards were kept for safety.", 10_000);
  }

  async auditMovedFiles(manual = false): Promise<void> {
    if (Platform.isMobile) {
      if (manual) {
        new Notice("Path auditing runs on desktop, where the synchronized mobile outbox can be reconciled with Anki.");
      }
      return;
    }
    const existingPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    const missing = this.data.files.filter(
      (file) => file.missingReason !== "deleted-in-obsidian" && !existingPaths.has(file.path)
    );
    if (missing.length === 0) {
      if (manual) {
        new Notice("Path audit complete: no ambiguous missing or moved source notes.");
      }
      return;
    }
    const registeredPaths = new Set(this.data.files.map((file) => file.path));
    const candidates = this.app.vault.getMarkdownFiles().filter((file) => !registeredPaths.has(file.path));
    const candidateHashes = new Map<string, TFile[]>();
    for (const candidate of candidates) {
      const hash = stableHash(await this.app.vault.cachedRead(candidate));
      const bucket = candidateHashes.get(hash) ?? [];
      bucket.push(candidate);
      candidateHashes.set(hash, bucket);
      await yieldToUi();
    }
    let moved = 0;
    for (const fileRecord of missing) {
      const matches = candidateHashes.get(fileRecord.contentHash) ?? [];
      if (matches.length === 1 && matches[0]) {
        const oldPath = fileRecord.path;
        moveRegistryFile(fileRecord, this.data.cards, matches[0].path);
        this.resolveConflict("FILE_MISSING", oldPath);
        await this.syncFileGuarded(matches[0], false);
        moved += 1;
      } else {
        this.resolveConflict(matches.length > 1 ? "FILE_MISSING" : "FILE_MOVE_AMBIGUOUS", fileRecord.path);
        fileRecord.missingReason = "unknown";
        this.recordConflict(
          matches.length > 1 ? "FILE_MOVE_AMBIGUOUS" : "FILE_MISSING",
          matches.length > 1
            ? "Multiple files have identical content, so the new path will not be guessed."
            : "Source note not found. Anki cards remain unchanged.",
          fileRecord.path
        );
      }
    }
    await this.savePluginData();
    if (manual || moved > 0) {
      new Notice(`Path audit: ${moved} moved note(s) matched unambiguously.`, 8_000);
    }
  }

  private async openSourceCard(rawCardKey: string | undefined): Promise<void> {
    if (!rawCardKey) {
      new Notice("The Obsidian link does not contain a card ID.");
      return;
    }
    let card = this.data.cards.find((candidate) => candidate.key === rawCardKey);
    if (!card) {
      card = this.data.cards.find((candidate) => candidate.children.some((child) => child.key === rawCardKey));
    }
    if (!card) {
      new Notice("The linked card is not registered in this vault.", 10_000);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(card.sourcePath);
    if (!(file instanceof TFile)) {
      this.recordConflict("FILE_MISSING", "The linked source note is missing.", card.sourcePath, card.key);
      await this.savePluginData();
      new Notice("Source note not found; see the conflict report.", 10_000);
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view;
    if (view instanceof MarkdownView) {
      const source = view.editor.getValue();
      const from = view.editor.offsetToPos(Math.min(card.startOffset, source.length));
      const to = view.editor.offsetToPos(Math.min(card.endOffset, source.length));
      view.editor.setSelection(from, to);
      view.editor.scrollIntoView({ from, to }, true);
      new Notice("The source card was highlighted.", 4_000);
    }
  }

  private async openCardAtCursor(editor: Editor): Promise<void> {
    if (Platform.isMobile) {
      new Notice("Opening the Anki browser is available only through desktop AnkiConnect.");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      return;
    }
    const offset = editor.posToOffset(editor.getCursor());
    const parsed = this.parser.parse(editor.getValue()).find(
      (card) => offset >= card.ranges.whole.from && offset <= card.ranges.whole.to
    );
    const registry = parsed
      ? this.data.cards.find((card) => card.sourcePath === file.path && card.ordinal === parsed.ordinal && card.status === "active")
      : undefined;
    const noteId = registry?.ankiNoteId ?? registry?.children.find((child) => child.status === "active")?.ankiNoteId;
    if (!noteId) {
      new Notice("No Anki note is registered for the card at the cursor yet.");
      return;
    }
    try {
      await this.client().guiBrowseNote(noteId);
    } catch (error) {
      this.recordConflict("ANKI_OPEN_FAILED", errorMessage(error), file.path, registry?.key);
      await this.savePluginData();
      new Notice(`Anki could not open the card: ${errorMessage(error)}`, 10_000);
    }
  }

  private client(): AnkiConnectClient {
    return new AnkiConnectClient(this.bridgeSettings.ankiConnectUrl, this.bridgeSettings.ankiConnectApiKey);
  }

  async deleteRemovedCard(conflictKey: string): Promise<number> {
    const conflict = this.data.conflicts.find(
      (candidate) => candidate.key === conflictKey && candidate.resolvedAt === undefined
    );
    if (!conflict || !isRemovalConflict(conflict) || !conflict.cardKey) {
      throw new Error("This pending deletion is no longer current.");
    }
    const target = findRegistryTarget(this.data.cards, conflict.cardKey);
    const isStillMissing = target?.child ? target.child.status === "missing" : target?.card.status === "missing";
    if (!target || !isStillMissing) {
      throw new Error("The card is present in the note again or is no longer registered.");
    }

    if (Platform.isMobile) {
      await this.mobileOutbox.enqueue({
        type: "confirm-delete",
        conflictKey: conflict.key,
        cardKey: conflict.cardKey
      });
      await this.refreshMobileOutboxCount();
      return -1;
    }

    const ownedNotes = target.child
      ? [{ key: target.child.key, noteId: target.child.ankiNoteId }]
      : [
          { key: target.card.key, noteId: target.card.ankiNoteId },
          ...target.card.children.map((child) => ({ key: child.key, noteId: child.ankiNoteId }))
        ];
    const client = this.client();
    try {
      await client.ping();
      const noteIds = new Set<number>();
      for (const owned of ownedNotes) {
        const matches = new Set(await client.findNoteIdsByCardKey(owned.key));
        if (owned.noteId !== undefined) {
          const info = await client.noteInfo(owned.noteId);
          if (info) {
            if (!noteBelongsToCardKey(info, owned.key)) {
              throw new Error("The stored Anki mapping points to an unrelated note; nothing was deleted.");
            }
            matches.add(owned.noteId);
          }
        }
        if (matches.size > 1) {
          throw new Error("Multiple Anki notes use the same bridge ID; nothing was deleted.");
        }
        for (const noteId of matches) {
          noteIds.add(noteId);
        }
      }

      const latestTarget = findRegistryTarget(this.data.cards, conflict.cardKey);
      const latestStillMissing = latestTarget?.child
        ? latestTarget.child.status === "missing"
        : latestTarget?.card.status === "missing";
      if (!latestTarget || !latestStillMissing) {
        throw new Error("The card became active in Obsidian during confirmation; nothing was deleted.");
      }

      await client.deleteNotes([...noteIds]);
      for (const noteId of noteIds) {
        if (await client.noteInfo(noteId)) {
          throw new Error("Anki did not fully apply the confirmed deletion.");
        }
      }
      for (const owned of ownedNotes) {
        if ((await client.findNoteIdsByCardKey(owned.key)).length > 0) {
          throw new Error("An Anki note with this bridge ID still exists after deletion.");
        }
      }

      if (target.child) {
        target.card.children = target.card.children.filter((child) => child.key !== target.child?.key);
      } else {
        this.data.cards = this.data.cards.filter((card) => card.key !== target.card.key);
      }
      for (const owned of ownedNotes) {
        this.resolveConflict("CARD_REMOVED", conflict.path, owned.key);
        this.resolveConflict("LIST_ITEM_REMOVED", conflict.path, owned.key);
        this.resolveConflict("ANKI_DELETE_FAILED", conflict.path, owned.key);
      }
      if (!target.child) {
        const sourceFile = this.data.files.find((file) => file.key === target.card.fileKey);
        const hasRemainingCards = this.data.cards.some((card) => card.fileKey === target.card.fileKey);
        if (sourceFile?.missingReason === "deleted-in-obsidian" && !hasRemainingCards) {
          this.data.files = this.data.files.filter((file) => file.key !== sourceFile.key);
          this.resolveConflict("FILE_MISSING", sourceFile.path);
          this.resolveConflict("FILE_MOVE_AMBIGUOUS", sourceFile.path);
        }
      }
      await this.savePluginData();
      return noteIds.size;
    } catch (error) {
      this.recordConflict(
        "ANKI_DELETE_FAILED",
        `Confirmed deletion failed: ${errorMessage(error)}`,
        conflict.path,
        conflict.cardKey
      );
      await this.savePluginData();
      throw error;
    }
  }

  private recordConflict(
    code: string,
    message: string,
    path?: string,
    cardKey?: string,
    severity: "warning" | "error" = "error"
  ): void {
    const key = stableHash(`${code}\u241f${path ?? ""}\u241f${cardKey ?? ""}`);
    const existing = this.data.conflicts.find((conflict) => conflict.key === key);
    if (existing) {
      existing.message = message;
      existing.lastSeenAt = Date.now();
      existing.resolvedAt = undefined;
      existing.severity = severity;
      return;
    }
    this.data.conflicts.push({
      key,
      code,
      severity,
      message,
      path,
      cardKey,
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    });
  }

  private resolveConflict(code: string, path?: string, cardKey?: string): void {
    for (const conflict of this.data.conflicts) {
      if (
        conflict.code === code &&
        (path === undefined || conflict.path === path) &&
        (cardKey === undefined || conflict.cardKey === cardKey) &&
        conflict.resolvedAt === undefined
      ) {
        conflict.resolvedAt = Date.now();
      }
    }
  }

  private updateStatus(): void {
    if (!this.statusEl) {
      return;
    }
    const unresolved = unresolvedConflicts(this.data.conflicts);
    this.statusEl.empty();
    const icon = this.statusEl.createSpan({ cls: "oab-status-icon" });
    setIcon(icon, unresolved.length > 0 ? "alert-triangle" : this.queuedMobileActions > 0 ? "clock" : "badge-check");
    const parts: string[] = [];
    if (unresolved.length > 0) {
      parts.push(`${unresolved.length} conflict(s)`);
    }
    if (this.queuedMobileActions > 0) {
      parts.push(`${this.queuedMobileActions} queued`);
    }
    this.statusEl.createSpan({ text: parts.length > 0 ? ` Anki: ${parts.join(" · ")}` : " Anki ready" });
    this.statusEl.toggleClass("has-conflicts", unresolved.length > 0);
    this.statusEl.setAttr("aria-label", parts.length > 0
      ? `${parts.join(", ")} – click for details`
      : "No unresolved Obsidian Anki conflicts, deletions, or queued mobile changes");
  }

  showConflictReport(): void {
    new ConflictModal(this).open();
  }

  showHelp(): void {
    new HelpModal(this).open();
  }
}

class ConflictModal extends Modal {
  constructor(private readonly plugin: ObsidianAnkiBridge) {
    super(plugin.app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Obsidian Anki Bridge – Conflicts and deletions" });
    const conflicts = unresolvedConflicts(this.plugin.data.conflicts);
    if (this.plugin.queuedMobileActionCount > 0) {
      this.contentEl.createEl("p", {
        text: Platform.isMobile
          ? `${this.plugin.queuedMobileActionCount} change(s) are safely queued in the synchronized vault. Desktop Obsidian will send them through local AnkiConnect.`
          : `${this.plugin.queuedMobileActionCount} mobile change(s) are waiting for local AnkiConnect and will be retried automatically.`
      });
    }
    if (conflicts.length === 0) {
      this.contentEl.createEl("p", { text: "No unresolved conflicts or pending deletions." });
      return;
    }
    this.contentEl.createEl("p", {
      text: "Cards removed from notes remain in Anki. Only cards explicitly confirmed below are deleted."
    });
    for (const conflict of conflicts) {
      const item = this.contentEl.createDiv({ cls: `oab-conflict oab-conflict-${conflict.severity}` });
      item.createEl("strong", { text: conflictTitle(conflict) });
      item.createEl("p", { text: conflict.message });
      if (conflict.path) {
        item.createEl("code", { text: conflict.path });
      }
      const preview = conflict.cardKey ? registryPreview(this.plugin.data.cards, conflict.cardKey) : undefined;
      if (preview) {
        item.createEl("blockquote", { text: preview });
      }
      if (isRemovalConflict(conflict)) {
        const button = item.createEl("button", { text: "Delete from Anki …" });
        button.addClass("mod-warning");
        button.addEventListener("click", () => {
          new DeleteConfirmationModal(this.plugin, conflict, () => this.render()).open();
        });
      }
    }
  }
}

class DeleteConfirmationModal extends Modal {
  constructor(
    private readonly plugin: ObsidianAnkiBridge,
    private readonly conflict: SyncConflict,
    private readonly onDeleted: () => void
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Permanently delete this card from Anki?" });
    this.contentEl.createEl("p", {
      text: "This permanently deletes the card's learning progress and review history as well."
    });
    const preview = this.conflict.cardKey
      ? registryPreview(this.plugin.data.cards, this.conflict.cardKey)
      : undefined;
    if (preview) {
      this.contentEl.createEl("blockquote", { text: preview });
    }
    if (this.conflict.path) {
      this.contentEl.createEl("code", { text: this.conflict.path });
    }
    const actions = this.contentEl.createDiv({ cls: "oab-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { text: "Permanently delete from Anki" });
    confirm.addClasses(["mod-cta", "mod-warning"]);
    confirm.addEventListener("click", () => {
      cancel.disabled = true;
      confirm.disabled = true;
      confirm.setText("Deleting …");
      void this.plugin.deleteRemovedCard(this.conflict.key).then((deletedNotes) => {
        new Notice(
          deletedNotes === -1
            ? "Deletion confirmed and queued. Desktop AnkiConnect will verify and apply it when available."
            : deletedNotes === 0
            ? "The card was already absent from Anki; the registry entry was cleaned up."
            : `${deletedNotes} Anki note(s) permanently deleted.`,
          8_000
        );
        this.close();
        this.onDeleted();
      }).catch((error: unknown) => {
        new Notice(`Deletion failed: ${errorMessage(error)}\nThe entry remains in the report.`, 12_000);
        cancel.disabled = false;
        confirm.disabled = false;
        confirm.setText("Try again");
      });
    });
  }
}

class HelpModal extends Modal {
  constructor(private readonly plugin: ObsidianAnkiBridge) {
    super(plugin.app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("oab-help");
    void MarkdownRenderer.render(this.app, README_MARKDOWN, this.contentEl, "", this.plugin);
  }
}

function emptyData(): PluginData {
  return { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, files: [], cards: [], conflicts: [] };
}

function emptySummary(path: string): SyncSummary {
  return { path, parsedCards: 0, desiredNotes: 0, createdNotes: 0, updatedNotes: 0, movedCards: 0, conflicts: 0 };
}

function unresolvedConflicts(conflicts: SyncConflict[]): SyncConflict[] {
  return conflicts.filter((conflict) => conflict.resolvedAt === undefined);
}

function isRemovalConflict(conflict: SyncConflict): boolean {
  return conflict.code === "CARD_REMOVED" || conflict.code === "LIST_ITEM_REMOVED";
}

function conflictTitle(conflict: SyncConflict): string {
  if (conflict.code === "CARD_REMOVED") {
    return "Card removed from Obsidian";
  }
  if (conflict.code === "LIST_ITEM_REMOVED") {
    return "List item removed from Obsidian";
  }
  if (conflict.code === "FILE_MISSING") {
    return "Source note missing or moved";
  }
  if (conflict.code === "FILE_MOVE_AMBIGUOUS") {
    return "Source note move is ambiguous";
  }
  return conflict.code;
}

function findRegistryTarget(
  cards: RegistryCard[],
  cardKey: string
): { card: RegistryCard; child?: RegistryChild } | undefined {
  const card = cards.find((candidate) => candidate.key === cardKey);
  if (card) {
    return { card };
  }
  for (const candidate of cards) {
    const child = candidate.children.find((entry) => entry.key === cardKey);
    if (child) {
      return { card: candidate, child };
    }
  }
  return undefined;
}

function registryPreview(cards: RegistryCard[], cardKey: string): string | undefined {
  const target = findRegistryTarget(cards, cardKey);
  if (!target) {
    return undefined;
  }
  if (target.child) {
    const prompt = target.card.preview ? `${target.card.preview}\n` : "";
    return `${prompt}List item: ${target.child.preview || "(no saved preview)"}`;
  }
  return target.card.preview || "(No preview was saved for this older card.)";
}

function containsCanonicalMarker(source: string): boolean {
  return source.includes("%%oab:");
}

function syntaxWarnings(
  source: string,
  cards: ReturnType<FlashcardParser["parse"]>
): Array<{ code: string; message: string; cardKey?: string }> {
  const warnings: Array<{ code: string; message: string; cardKey?: string }> = [];
  const listStarts = source.split("\n").filter((line) => line.includes(LIST_START_MARKER)).length;
  const listEnds = source.split("\n").filter((line) => line.trimStart().startsWith(LIST_END_MARKER)).length;
  const dumpStarts = source.split("\n").filter((line) => line.includes(DUMP_START_MARKER)).length;
  const dumpEnds = source.split("\n").filter((line) => line.trimStart().startsWith(DUMP_END_MARKER)).length;
  if (listStarts !== listEnds || dumpStarts !== dumpEnds) {
    warnings.push({
      code: "INVALID_BLOCK",
      message: "At least one list or dump card is not closed correctly and was not synchronized."
    });
  }
  for (const card of cards) {
    const nestedSource = card.kind === "dump" ? card.back : card.kind === "list" ? card.items.join("\n") : "";
    if (nestedSource && containsCanonicalMarker(nestedSource)) {
      warnings.push({
        code: "NESTED_CARD_IGNORED",
        message: "A nested card inside a list or dump card was intentionally ignored to prevent corrupted cards."
      });
    }
  }
  return warnings;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickFields(fields: Record<string, string>, ownedFields: string[]): Record<string, string> {
  return Object.fromEntries(
    ownedFields
      .filter((field) => Object.hasOwn(fields, field))
      .map((field) => [field, fields[field] ?? ""])
  );
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
