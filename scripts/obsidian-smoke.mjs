import process from "node:process";

const debugPort = Number.parseInt(process.env.OAB_OBSIDIAN_DEBUG_PORT ?? "9223", 10);
const ankiUrl = process.env.OAB_ANKI_TEST_URL ?? "http://127.0.0.1:18765";
if (/:(?:8765)(?:\/|$)/.test(ankiUrl)) {
  throw new Error("Refusing to run an Obsidian smoke test against production AnkiConnect port 8765.");
}

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && target.url.startsWith("app://obsidian.md"));
if (!page?.webSocketDebuggerUrl) {
  throw new Error("No Obsidian renderer target found.");
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await command("Runtime.enable");
const keepAlive = setInterval(() => undefined, 1_000);
const result = await command("Runtime.evaluate", {
  expression: `globalThis.__oabSmokeRun = (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const trustButton = [...document.querySelectorAll(".modal button")]
      .find((button) => button.textContent?.includes("Trust author and enable plugins"));
    if (trustButton) {
      trustButton.click();
      await sleep(500);
      globalThis.app?.setting?.close();
      await sleep(200);
    }
    if (!globalThis.app?.plugins?.plugins?.["anki-bridge"]) {
      await globalThis.app?.plugins?.enablePlugin("anki-bridge");
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (globalThis.app?.plugins?.plugins?.["anki-bridge"]) break;
      await sleep(100);
    }
    const plugin = globalThis.app?.plugins?.plugins?.["anki-bridge"];
    if (!plugin) throw new Error("Plugin was not loaded by Obsidian.");
    for (const closeButton of document.querySelectorAll(".modal-close-button")) closeButton.click();
    await sleep(100);
    const file = globalThis.app.vault.getAbstractFileByPath("Test Cards.md");
    if (!file) throw new Error("Smoke-test note is missing.");
    await globalThis.app.workspace.getLeaf(false).openFile(file);
    await sleep(500);
    plugin.bridgeSettings.ankiConnectUrl = ${JSON.stringify(ankiUrl)};
    plugin.bridgeSettings.ankiConnectApiKey = "";
    plugin.bridgeSettings.autoSync = false;
    await plugin.savePluginData();
    const staleTestCards = plugin.data.cards.filter((card) => card.sourcePath.startsWith("Temporary "));
    const staleNoteIds = staleTestCards
      .flatMap((card) => [card.ankiNoteId, ...card.children.map((child) => child.ankiNoteId)])
      .filter(Boolean);
    if (staleNoteIds.length > 0) await plugin.client().deleteNotes(staleNoteIds);
    plugin.data.cards = plugin.data.cards.filter((card) => !card.sourcePath.startsWith("Temporary "));
    plugin.data.files = plugin.data.files.filter((entry) => !entry.path.startsWith("Temporary "));
    plugin.data.conflicts = plugin.data.conflicts.filter((conflict) => !conflict.path?.startsWith("Temporary "));
    await plugin.savePluginData();
    for (const staleFile of globalThis.app.vault.getFiles().filter((entry) => entry.path.startsWith("Temporary "))) {
      await globalThis.app.vault.delete(staleFile);
    }
    for (const staleFolder of globalThis.app.vault.getAllLoadedFiles()
      .filter((entry) => entry.path.startsWith("Temporary ") && !entry.extension)
      .sort((left, right) => right.path.length - left.path.length)) {
      if (globalThis.app.vault.getAbstractFileByPath(staleFolder.path)) {
        await globalThis.app.vault.delete(staleFolder, true);
      }
    }
    const summary = await plugin.syncFileGuarded(file, false);
    await sleep(250);
    const registry = plugin.data.cards.filter((card) => card.sourcePath === file.path);
    const noteIds = registry.flatMap((card) => [card.ankiNoteId, ...card.children.map((child) => child.ankiNoteId)]).filter(Boolean);
    await globalThis.app.vault.rename(file, "Test Cards Moved.md");
    const movedFile = globalThis.app.vault.getAbstractFileByPath("Test Cards Moved.md");
    if (!movedFile) throw new Error("Vault rename did not produce the moved file.");
    const movedSummary = await plugin.syncFileGuarded(movedFile, false);
    const expectedMovedDeck = "Obsidian Flashcards::test-vault::Test Cards Moved";
    const movedDecks = [];
    for (const noteId of noteIds) {
      const cardIds = await plugin.client().invoke("findCards", { query: "nid:" + noteId });
      const infos = await plugin.client().invoke("cardsInfo", { cards: cardIds });
      movedDecks.push(...infos.map((info) => info.deckName));
    }
    await globalThis.app.vault.rename(movedFile, "Test Cards.md");
    const restoredFile = globalThis.app.vault.getAbstractFileByPath("Test Cards.md");
    if (!restoredFile) throw new Error("Smoke-test file could not be restored.");
    await plugin.syncFileGuarded(restoredFile, false);
    const fileRecord = plugin.data.files.find((entry) => entry.path === "Test Cards.md");
    if (!fileRecord) throw new Error("Registry file record is missing.");
    fileRecord.path = "Simulated External Location/Test Cards.md";
    for (const card of registry) card.sourcePath = fileRecord.path;
    await plugin.auditMovedFiles(false);
    const externalMoveRecovered = fileRecord.path === "Test Cards.md" && registry.every((card) => card.sourcePath === "Test Cards.md");

    plugin.bridgeSettings.ankiConnectUrl = "http://127.0.0.1:18766";
    const failedResult = await plugin.syncFileGuarded(restoredFile, false);
    const failureVisible = failedResult === undefined &&
      plugin.data.conflicts.some((conflict) => conflict.code === "SYNC_FAILED" && conflict.resolvedAt === undefined) &&
      document.querySelector(".oab-status.has-conflicts") !== null;
    plugin.bridgeSettings.ankiConnectUrl = ${JSON.stringify(ankiUrl)};
    await plugin.syncFileGuarded(restoredFile, false);
    await plugin.openSourceCard(registry[0].key);
    const sourceLinkVerified = globalThis.app.workspace.getActiveFile()?.path === "Test Cards.md" &&
      globalThis.app.workspace.activeLeaf?.view?.editor?.getSelection().includes("What is acceleration?");
    const firstNote = await plugin.client().noteInfo(registry[0].ankiNoteId);
    const firstCardIds = await plugin.client().invoke("findCards", { query: "nid:" + registry[0].ankiNoteId });
    const firstCardInfo = (await plugin.client().invoke("cardsInfo", { cards: firstCardIds }))[0];
    const standardTemplates = await plugin.client().invoke("modelTemplates", {
      modelName: "Obsidian Flashcards - Standard v1"
    });
    const clozeTemplates = await plugin.client().invoke("modelTemplates", {
      modelName: "Obsidian Flashcards - Cloze v1"
    });
    const templateText = JSON.stringify({ standardTemplates, clozeTemplates });
    const noteNameIsLink = firstNote?.fields?.Context?.value?.includes('<a class="note" href="obsidian://anki-bridge?') &&
      firstNote.fields.Context.value.includes('>Test Cards</a>');
    const redundantSourceRemoved = firstNote?.fields?.Source?.value === "" &&
      !templateText.includes("{{Source}}") && !templateText.includes("In Obsidian öffnen") &&
      !templateText.includes("<footer>");
    const renderedCardClean = firstCardInfo?.question?.includes('href="obsidian://anki-bridge?') &&
      !firstCardInfo?.answer?.includes("In Obsidian öffnen") &&
      !firstCardInfo?.answer?.includes("Test Cards.md") &&
      !firstCardInfo?.answer?.includes("<footer>");

    plugin.showHelp();
    await sleep(200);
    const helpModal = [...document.querySelectorAll(".modal")].at(-1);
    const helpVisible = helpModal?.querySelector(".oab-help h1")?.textContent === "Anki Bridge" &&
      helpModal?.querySelector(".oab-help")?.textContent?.includes("Card formats");
    helpModal?.querySelector(".modal-close-button")?.click();

    const mediaFolder = "Temporary Media Test " + Date.now();
    await globalThis.app.vault.createFolder(mediaFolder);
    const pixelBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
    await globalThis.app.vault.createBinary(mediaFolder + "/pixel.png", pixelBytes);
    const canvasSource = JSON.stringify({
      nodes: [
        { id: "one", type: "text", x: 0, y: 0, width: 180, height: 80, text: "First node" },
        { id: "two", type: "text", x: 320, y: 120, width: 180, height: 80, text: "Second node", color: "5" }
      ],
      edges: [{ id: "edge", fromNode: "one", toNode: "two", label: "connects" }]
    });
    await globalThis.app.vault.create(mediaFolder + "/sample.canvas", canvasSource);
    const pdfObjects = [
      "1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n",
      "2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj\\n",
      "3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\\nendobj\\n",
      "4 0 obj\\n<< /Length 48 >>\\nstream\\nBT /F1 24 Tf 60 130 Td (PDF preview test) Tj ET\\nendstream\\nendobj\\n",
      "5 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj\\n"
    ];
    let pdfSource = "%PDF-1.4\\n";
    const pdfOffsets = [0];
    for (const object of pdfObjects) {
      pdfOffsets.push(new TextEncoder().encode(pdfSource).length);
      pdfSource += object;
    }
    const xrefOffset = new TextEncoder().encode(pdfSource).length;
    pdfSource += "xref\\n0 6\\n0000000000 65535 f \\n";
    for (const offset of pdfOffsets.slice(1)) pdfSource += String(offset).padStart(10, "0") + " 00000 n \\n";
    pdfSource += "trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n" + xrefOffset + "\\n%%EOF\\n";
    await globalThis.app.vault.createBinary(mediaFolder + "/sample.pdf", new TextEncoder().encode(pdfSource));
    const mediaPath = mediaFolder + "/Media Cards.md";
    const mediaSource = [
      "# Media cards",
      "Basic image ⇢%%oab:basic:v1%%![[pixel.png]]",
      "Image card ⇢▣%%oab:image:v1%%![[pixel.png]]",
      "Rich media ⇢{%%oab:dump:v1%%",
      "![[sample.pdf]]",
      "![[sample.canvas]]",
      "}⇠%%oab:end:v1%%"
    ].join("\\n");
    const mediaFile = await globalThis.app.vault.create(mediaPath, mediaSource);
    const mediaSummary = await plugin.syncFileGuarded(mediaFile, false);
    const mediaRegistry = plugin.data.cards.filter((card) => card.sourcePath === mediaPath);
    const mediaNoteIds = mediaRegistry.map((card) => card.ankiNoteId).filter(Boolean);
    const mediaNotes = await plugin.client().invoke("notesInfo", { notes: mediaNoteIds });
    const mediaBackHtml = mediaNotes.map((note) => note.fields?.Back?.value ?? "").join("\\n");
    const allMediaHtml = mediaNotes.flatMap((note) => Object.values(note.fields ?? {}).map((field) => field.value)).join("\\n");
    const mediaNames = [...new Set([...allMediaHtml.matchAll(/(?:src|href)=\"(oab-[^\"]+)\"/g)].map((match) => match[1]))];
    const retrievedMedia = [];
    for (const filename of mediaNames) {
      retrievedMedia.push(await plugin.client().invoke("retrieveMediaFile", { filename }));
    }
    const imageMarkupIsHtml = allMediaHtml.includes('<img class="oab-media"') && !allMediaHtml.includes("&lt;img");
    const imageCard = mediaRegistry.find((card) => card.kind === "image-occlusion");
    const imageNote = mediaNotes.find((note) => note.noteId === imageCard?.ankiNoteId);
    const imageOcclusionNative = imageNote?.modelName === "Image Occlusion" &&
      imageNote.fields?.Occlusion?.value?.includes("image-occlusion:rect:") &&
      imageNote.tags?.includes("oab-image-occlusion") &&
      imageNote.tags?.includes("oab-id-" + imageCard?.key);
    const editedOcclusion = "{{c9::image-occlusion:rect:left=.2:top=.3:width=.4:height=.1}}";
    await plugin.client().invoke("updateNoteFields", {
      note: { id: imageCard.ankiNoteId, fields: { Occlusion: editedOcclusion, Comments: "Kept in Anki" } }
    });
    await plugin.syncFileGuarded(mediaFile, false);
    const imageNoteAfterResync = await plugin.client().noteInfo(imageCard.ankiNoteId);
    const imageOcclusionMaskPreserved = imageNoteAfterResync?.fields?.Occlusion?.value === editedOcclusion &&
      imageNoteAfterResync?.fields?.Comments?.value === "Kept in Anki";
    const embeddedVisualsLinkToObsidian = allMediaHtml.includes("obsidian://open?vault=test-vault&amp;file=") &&
      allMediaHtml.includes("sample.canvas") && allMediaHtml.includes("sample.pdf") && allMediaHtml.includes("pixel.png");
    const canvasRendered = mediaBackHtml.includes(".svg") && mediaBackHtml.includes("oab-rendered-visual");
    const pdfPreviewRendered = mediaBackHtml.includes('class="oab-document"') && mediaBackHtml.includes(">PDF</a>");
    const visualRenderCount = (mediaBackHtml.match(/class=\"oab-rendered-visual\"/g) ?? []).length;
    const allMediaPresent = mediaNames.length >= 4 && retrievedMedia.every((data) => typeof data === "string" && data.length > 0);
    const mediaWarnings = plugin.data.conflicts
      .filter((conflict) => conflict.path === mediaPath && conflict.resolvedAt === undefined)
      .map((conflict) => conflict.message);
    await plugin.client().deleteNotes(mediaNoteIds);
    plugin.data.cards = plugin.data.cards.filter((card) => card.sourcePath !== mediaPath);
    plugin.data.files = plugin.data.files.filter((entry) => entry.path !== mediaPath);
    await globalThis.app.vault.delete(mediaFile);
    for (const path of [mediaFolder + "/pixel.png", mediaFolder + "/sample.canvas", mediaFolder + "/sample.pdf"]) {
      const temporaryFile = globalThis.app.vault.getAbstractFileByPath(path);
      if (temporaryFile) await globalThis.app.vault.delete(temporaryFile);
    }
    const temporaryFolder = globalThis.app.vault.getAbstractFileByPath(mediaFolder);
    if (temporaryFolder) await globalThis.app.vault.delete(temporaryFolder, true);
    await sleep(100);
    plugin.data.conflicts = plugin.data.conflicts.filter((conflict) => conflict.path !== mediaPath);
    await plugin.savePluginData();

    const deletionPath = "Temporary Deletion Test " + Date.now() + ".md";
    const deletionSource = [
      "Deletion prompt ⇢[%%oab:list:v1%%",
      "- Keep this item",
      "- Remove this item",
      "]⇠%%oab:end:v1%%"
    ].join("\\n");
    const deletionFile = await globalThis.app.vault.create(deletionPath, deletionSource);
    await plugin.syncFileGuarded(deletionFile, false);
    const deletionCard = plugin.data.cards.find((card) => card.sourcePath === deletionPath);
    const keptChild = deletionCard?.children.find((child) => child.preview === "Keep this item");
    const removedChild = deletionCard?.children.find((child) => child.preview === "Remove this item");
    if (!deletionCard || !keptChild?.ankiNoteId || !removedChild?.ankiNoteId) {
      throw new Error("Deletion test notes were not created.");
    }
    await globalThis.app.vault.modify(deletionFile, [
      "Deletion prompt ⇢[%%oab:list:v1%%",
      "- Keep this item",
      "]⇠%%oab:end:v1%%"
    ].join("\\n"));
    await plugin.syncFileGuarded(deletionFile, false);
    const itemRemoval = plugin.data.conflicts.find((conflict) =>
      conflict.code === "LIST_ITEM_REMOVED" && conflict.cardKey === removedChild.key && conflict.resolvedAt === undefined
    );
    if (!itemRemoval) throw new Error("Removed list item was not quarantined.");
    plugin.showConflictReport();
    await sleep(100);
    const reportModal = [...document.querySelectorAll(".modal")].at(-1);
    const deletionButton = [...(reportModal?.querySelectorAll(".oab-conflict button") ?? [])]
      .find((button) => button.textContent?.includes("Delete from Anki"));
    const deletionButtonVisible = Boolean(deletionButton);
    deletionButton?.click();
    await sleep(100);
    const confirmationModal = [...document.querySelectorAll(".modal")].at(-1);
    const confirmationButton = [...(confirmationModal?.querySelectorAll(".oab-modal-actions button") ?? [])]
      .find((button) => button.textContent?.includes("Permanently delete from Anki"));
    const deletionConfirmationVisible = Boolean(confirmationButton) &&
      confirmationModal?.querySelector("h2")?.textContent?.includes("Permanently delete");
    const confirmationInitiallyDisabled = confirmationButton?.disabled ?? true;
    const clickDispatched = confirmationButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) ?? false;
    await sleep(250);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!deletionCard.children.some((child) => child.key === removedChild.key)) break;
      await sleep(100);
    }
    const confirmationFinalText = confirmationButton?.textContent;
    const deletionUiError = plugin.data.conflicts.find((conflict) =>
      conflict.code === "ANKI_DELETE_FAILED" && conflict.cardKey === removedChild.key && conflict.resolvedAt === undefined
    )?.message;
    confirmationModal?.querySelector(".modal-close-button")?.click();
    reportModal?.querySelector(".modal-close-button")?.click();
    const removedChildDeleted = !(await plugin.client().noteInfo(removedChild.ankiNoteId));
    const childRegistryRemoved = !deletionCard.children.some((child) => child.key === removedChild.key);
    const deletedListNotes = removedChildDeleted && childRegistryRemoved ? 1 : 0;
    const keptChildRetained = Boolean(await plugin.client().noteInfo(keptChild.ankiNoteId));

    await globalThis.app.vault.modify(deletionFile, "# No cards remain");
    await plugin.syncFileGuarded(deletionFile, false);
    const cardRemoval = plugin.data.conflicts.find((conflict) =>
      conflict.code === "CARD_REMOVED" && conflict.cardKey === deletionCard.key && conflict.resolvedAt === undefined
    );
    if (!cardRemoval) throw new Error("Removed parent card was not quarantined.");
    const deletedParentNotes = await plugin.deleteRemovedCard(cardRemoval.key);
    const keptChildDeletedAfterParentConfirmation = !(await plugin.client().noteInfo(keptChild.ankiNoteId));
    const deletionRegistryCleared = !plugin.data.cards.some((card) => card.key === deletionCard.key);
    plugin.data.files = plugin.data.files.filter((entry) => entry.path !== deletionPath);
    await plugin.savePluginData();
    await globalThis.app.vault.delete(deletionFile);

    const directDeletePath = "Temporary Direct Note Deletion " + Date.now() + ".md";
    const directDeleteSource = [
      "First whole-note card ⇢%%oab:basic:v1%%First answer",
      "Second whole-note card ⇢%%oab:basic:v1%%Second answer"
    ].join("\\n");
    const directDeleteFile = await globalThis.app.vault.create(directDeletePath, directDeleteSource);
    await plugin.syncFileGuarded(directDeleteFile, false);
    const directCards = plugin.data.cards.filter((card) => card.sourcePath === directDeletePath);
    const directNoteIds = directCards.map((card) => card.ankiNoteId).filter(Boolean);
    if (directCards.length !== 2 || directNoteIds.length !== 2) {
      throw new Error("Direct note-deletion test cards were not created.");
    }
    await globalThis.app.fileManager.trashFile(directDeleteFile);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const count = plugin.data.conflicts.filter((conflict) =>
        conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
      ).length;
      if (count === directCards.length) break;
      await sleep(100);
    }
    const firstDirectPending = plugin.data.conflicts.filter((conflict) =>
      conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
    );
    const directDeleteClassified = firstDirectPending.length === directCards.length &&
      !plugin.data.conflicts.some((conflict) =>
        conflict.code === "FILE_MISSING" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
      );
    const directNotesRetainedBeforeConfirmation = (await Promise.all(
      directNoteIds.map((noteId) => plugin.client().noteInfo(noteId))
    )).every(Boolean);

    const recreatedDirectFile = await globalThis.app.vault.create(directDeletePath, directDeleteSource);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const restored = directCards.every((card) => card.status === "active") &&
        !plugin.data.conflicts.some((conflict) =>
          conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
        );
      if (restored) break;
      await sleep(100);
    }
    const directRestoreClearedPending = directCards.every((card) => card.status === "active") &&
      !plugin.data.conflicts.some((conflict) =>
        conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
      ) && (await Promise.all(directNoteIds.map((noteId) => plugin.client().noteInfo(noteId)))).every(Boolean);

    await globalThis.app.fileManager.trashFile(recreatedDirectFile);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const count = plugin.data.conflicts.filter((conflict) =>
        conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
      ).length;
      if (count === directCards.length) break;
      await sleep(100);
    }
    const directPending = plugin.data.conflicts.filter((conflict) =>
      conflict.code === "CARD_REMOVED" && conflict.path === directDeletePath && conflict.resolvedAt === undefined
    );
    plugin.showConflictReport();
    await sleep(100);
    const directReportModal = [...document.querySelectorAll(".modal")].at(-1);
    const directConflictItems = [...(directReportModal?.querySelectorAll(".oab-conflict") ?? [])].filter((item) =>
      item.querySelector("code")?.textContent === directDeletePath
    );
    const directDeleteButtonsVisible = directConflictItems.length === directCards.length && directConflictItems.every((item) =>
      [...item.querySelectorAll("button")].some((button) => button.textContent?.includes("Delete from Anki"))
    );
    directReportModal?.querySelector(".modal-close-button")?.click();
    let directDeletedNotes = 0;
    for (const conflict of directPending) {
      directDeletedNotes += await plugin.deleteRemovedCard(conflict.key);
    }
    const directAnkiNotesDeleted = (await Promise.all(
      directNoteIds.map((noteId) => plugin.client().noteInfo(noteId))
    )).every((note) => !note);
    const directRegistryCleared = !plugin.data.cards.some((card) => card.sourcePath === directDeletePath) &&
      !plugin.data.files.some((entry) => entry.path === directDeletePath);

    const ambiguousBase = "Temporary Ambiguous Note " + Date.now();
    const ambiguousPath = ambiguousBase + ".md";
    const ambiguousNewPath = ambiguousBase + " Moved.md";
    const ambiguousSource = "Ambiguous disappearance ⇢%%oab:basic:v1%%Keep this Anki note";
    const ambiguousFile = await globalThis.app.vault.create(ambiguousPath, ambiguousSource);
    await plugin.syncFileGuarded(ambiguousFile, false);
    const ambiguousCard = plugin.data.cards.find((card) => card.sourcePath === ambiguousPath);
    if (!ambiguousCard?.ankiNoteId) throw new Error("Ambiguous-disappearance test note was not created.");
    await globalThis.app.vault.delete(ambiguousFile);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (plugin.data.conflicts.some((conflict) =>
        conflict.code === "FILE_MISSING" && conflict.path === ambiguousPath && conflict.resolvedAt === undefined
      )) break;
      await sleep(100);
    }
    const ambiguousConflictOnly = plugin.data.conflicts.some((conflict) =>
      conflict.code === "FILE_MISSING" && conflict.path === ambiguousPath && conflict.resolvedAt === undefined
    ) && !plugin.data.conflicts.some((conflict) =>
      conflict.code === "CARD_REMOVED" && conflict.path === ambiguousPath && conflict.resolvedAt === undefined
    );
    const ambiguousAnkiNoteRetained = Boolean(await plugin.client().noteInfo(ambiguousCard.ankiNoteId));
    const movedAmbiguousFile = await globalThis.app.vault.create(ambiguousNewPath, ambiguousSource);
    plugin.showConflictReport();
    await sleep(100);
    const ambiguousReportModal = [...document.querySelectorAll(".modal")].at(-1);
    const ambiguousConflictItem = [...(ambiguousReportModal?.querySelectorAll(".oab-conflict") ?? [])].find((item) =>
      item.querySelector("code")?.textContent === ambiguousPath
    );
    const ambiguousButtons = [...(ambiguousConflictItem?.querySelectorAll("button") ?? [])];
    const ambiguousDeleteButton = ambiguousButtons.find((button) => button.textContent?.includes("Delete all from Anki"));
    const ambiguousNewPathButton = ambiguousButtons.find((button) => button.textContent?.includes("Set new path"));
    const ambiguousResolutionButtonsVisible = Boolean(ambiguousDeleteButton) && Boolean(ambiguousNewPathButton);
    ambiguousNewPathButton?.click();
    await sleep(100);
    const relinkModal = [...document.querySelectorAll(".modal")].at(-1);
    const relinkInput = relinkModal?.querySelector(".oab-path-input");
    const relinkConfirm = [...(relinkModal?.querySelectorAll(".oab-modal-actions button") ?? [])]
      .find((button) => button.textContent?.includes("Use new path"));
    if (relinkInput) relinkInput.value = ambiguousNewPath.slice(0, -3);
    relinkConfirm?.click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!document.body.contains(relinkModal) &&
          ambiguousCard.sourcePath === ambiguousNewPath && !plugin.data.conflicts.some((conflict) =>
        conflict.path === ambiguousPath && conflict.resolvedAt === undefined
      )) break;
      await sleep(100);
    }
    const relinkedCardInfo = await plugin.client().noteInfo(ambiguousCard.ankiNoteId);
    const relinkedCardIds = await plugin.client().invoke("findCards", { query: "nid:" + ambiguousCard.ankiNoteId });
    const relinkedDecks = await plugin.client().invoke("cardsInfo", { cards: relinkedCardIds });
    const expectedRelinkedDeck = "Obsidian Flashcards::test-vault::" + ambiguousNewPath.slice(0, -3);
    const ambiguousRelinked = ambiguousCard.sourcePath === ambiguousNewPath &&
      relinkedCardInfo?.noteId === ambiguousCard.ankiNoteId &&
      relinkedDecks.every((card) => card.deckName === expectedRelinkedDeck) &&
      !plugin.data.conflicts.some((conflict) =>
        conflict.path === ambiguousPath && conflict.resolvedAt === undefined
      );
    ambiguousReportModal?.querySelector(".modal-close-button")?.click();
    await plugin.client().deleteNotes([ambiguousCard.ankiNoteId]);
    plugin.data.cards = plugin.data.cards.filter((card) => card.sourcePath !== ambiguousNewPath);
    plugin.data.files = plugin.data.files.filter((entry) => entry.path !== ambiguousNewPath);
    plugin.data.conflicts = plugin.data.conflicts.filter((conflict) =>
      conflict.path !== ambiguousPath && conflict.path !== ambiguousNewPath
    );
    await plugin.savePluginData();
    await globalThis.app.vault.delete(movedAmbiguousFile);

    const externalDeletePath = "Temporary External Delete " + Date.now() + ".md";
    const externalDeleteSource = [
      "First externally deleted card ⇢%%oab:basic:v1%%First answer",
      "Second externally deleted card ⇢%%oab:basic:v1%%Second answer"
    ].join("\\n");
    const externalDeleteFile = await globalThis.app.vault.create(externalDeletePath, externalDeleteSource);
    await plugin.syncFileGuarded(externalDeleteFile, false);
    const externalDeleteCards = plugin.data.cards.filter((card) => card.sourcePath === externalDeletePath);
    const externalDeleteNoteIds = externalDeleteCards.map((card) => card.ankiNoteId).filter(Boolean);
    if (externalDeleteCards.length !== 2 || externalDeleteNoteIds.length !== 2) {
      throw new Error("External whole-file deletion test cards were not created.");
    }
    await globalThis.app.vault.delete(externalDeleteFile);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (plugin.data.conflicts.some((conflict) =>
        conflict.code === "FILE_MISSING" && conflict.path === externalDeletePath && conflict.resolvedAt === undefined
      )) break;
      await sleep(100);
    }
    plugin.showConflictReport();
    await sleep(100);
    const externalDeleteReport = [...document.querySelectorAll(".modal")].at(-1);
    const externalDeleteConflictItem = [...(externalDeleteReport?.querySelectorAll(".oab-conflict") ?? [])].find((item) =>
      item.querySelector("code")?.textContent === externalDeletePath
    );
    const deleteAllButton = [...(externalDeleteConflictItem?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent?.includes("Delete all from Anki"));
    deleteAllButton?.click();
    await sleep(100);
    const deleteAllConfirmation = [...document.querySelectorAll(".modal")].at(-1);
    const deleteAllConfirmationVisible = deleteAllConfirmation?.querySelector("h2")?.textContent
      ?.includes("Permanently delete all cards") === true;
    const confirmDeleteAll = [...(deleteAllConfirmation?.querySelectorAll(".oab-modal-actions button") ?? [])]
      .find((button) => button.textContent?.includes("Permanently delete all from Anki"));
    confirmDeleteAll?.click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!plugin.data.files.some((file) => file.path === externalDeletePath)) break;
      await sleep(100);
    }
    const externalDeleteApplied = (await Promise.all(
      externalDeleteNoteIds.map((noteId) => plugin.client().noteInfo(noteId))
    )).every((note) => !note) &&
      !plugin.data.cards.some((card) => card.sourcePath === externalDeletePath) &&
      !plugin.data.files.some((file) => file.path === externalDeletePath) &&
      !plugin.data.conflicts.some((conflict) =>
        conflict.path === externalDeletePath && conflict.resolvedAt === undefined
      );
    externalDeleteReport?.querySelector(".modal-close-button")?.click();

    const mobileOutboxPath = "Temporary Mobile Outbox " + Date.now() + ".md";
    const mobileOutboxSource = "Queued on mobile ⇢%%oab:basic:v1%%First desktop answer";
    const mobileOutboxFile = await globalThis.app.vault.create(mobileOutboxPath, mobileOutboxSource);
    const sharedStateAvailable = await globalThis.app.vault.adapter.exists(".obsidian-anki-bridge/data.json");
    const firstMobileEvent = await plugin.mobileOutbox.enqueue({ type: "upsert", path: mobileOutboxPath });
    const sharedOutboxUsed = firstMobileEvent.storagePath.startsWith(".obsidian-anki-bridge/mobile-outbox/");
    await plugin.processMobileOutbox();
    const mobileOutboxCard = plugin.data.cards.find((card) => card.sourcePath === mobileOutboxPath);
    if (!mobileOutboxCard?.ankiNoteId) throw new Error("Mobile outbox did not create its Anki note.");
    const mobileCreatedNote = await plugin.client().noteInfo(mobileOutboxCard.ankiNoteId);
    const mobileOutboxCreated = mobileCreatedNote?.fields?.Back?.value?.includes("First desktop answer") === true;
    const editedMobileOutboxSource = "Queued on mobile ⇢%%oab:basic:v1%%Edited on the phone";
    await globalThis.app.vault.adapter.write(mobileOutboxPath, editedMobileOutboxSource);
    await plugin.mobileOutbox.enqueue({ type: "upsert", path: mobileOutboxPath });
    await plugin.processMobileOutbox();
    const mobileUpdatedNote = await plugin.client().noteInfo(mobileOutboxCard.ankiNoteId);
    const mobileOutboxUpdated = mobileUpdatedNote?.fields?.Back?.value?.includes("Edited on the phone") === true;
    await globalThis.app.vault.adapter.write(
      mobileOutboxPath,
      "Queued on mobile ⇢%%oab:basic:v1%%Migrated legacy event"
    );
    await plugin.mobileOutboxes[1].enqueue({ type: "upsert", path: mobileOutboxPath });
    await plugin.processMobileOutbox();
    const legacyUpdatedNote = await plugin.client().noteInfo(mobileOutboxCard.ankiNoteId);
    const legacyOutboxMigrated = legacyUpdatedNote?.fields?.Back?.value?.includes("Migrated legacy event") === true &&
      (await plugin.mobileOutboxes[1].snapshot()).events.length === 0;

    await globalThis.app.vault.delete(mobileOutboxFile);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (plugin.data.conflicts.some((conflict) =>
        conflict.code === "FILE_MISSING" && conflict.path === mobileOutboxPath && conflict.resolvedAt === undefined
      )) break;
      await sleep(50);
    }
    await plugin.mobileOutbox.enqueue({ type: "delete", path: mobileOutboxPath });
    await plugin.processMobileOutbox();
    const mobileRemovalConflict = plugin.data.conflicts.find((conflict) =>
      conflict.code === "CARD_REMOVED" && conflict.cardKey === mobileOutboxCard.key && conflict.resolvedAt === undefined
    );
    const mobileDeleteQuarantined = Boolean(mobileRemovalConflict) && Boolean(await plugin.client().noteInfo(mobileOutboxCard.ankiNoteId));
    if (!mobileRemovalConflict) throw new Error("Mobile deletion was not converted into a pending deletion.");
    await plugin.mobileOutbox.enqueue({
      type: "confirm-delete",
      conflictKey: mobileRemovalConflict.key,
      cardKey: mobileOutboxCard.key
    });
    await plugin.processMobileOutbox();
    const mobileConfirmedDeletionApplied = !(await plugin.client().noteInfo(mobileOutboxCard.ankiNoteId)) &&
      !plugin.data.cards.some((card) => card.key === mobileOutboxCard.key) &&
      !plugin.data.files.some((entry) => entry.path === mobileOutboxPath);
    const mobileOutboxDrained = (await plugin.mobileOutbox.snapshot()).events.length === 0;

    const externalScanPath = "Temporary External Scan " + Date.now() + ".md";
    const externalScanFile = await globalThis.app.vault.create(
      externalScanPath,
      "External scan ⇢%%oab:basic:v1%%Initial answer"
    );
    await plugin.syncFileGuarded(externalScanFile, false);
    const externalScanCard = plugin.data.cards.find((card) => card.sourcePath === externalScanPath);
    if (!externalScanCard?.ankiNoteId) throw new Error("External scan setup did not create its Anki note.");
    await globalThis.app.vault.adapter.write(
      externalScanPath,
      "External scan ⇢%%oab:basic:v1%%Changed outside Obsidian"
    );
    plugin.bridgeSettings.autoSync = true;
    await plugin.scanExternalChanges(false);
    plugin.bridgeSettings.autoSync = false;
    const externalScanNote = await plugin.client().noteInfo(externalScanCard.ankiNoteId);
    const externalFileScanRecovered = externalScanNote?.fields?.Back?.value?.includes("Changed outside Obsidian") === true;
    await plugin.client().deleteNotes([externalScanCard.ankiNoteId]);
    plugin.data.cards = plugin.data.cards.filter((card) => card.sourcePath !== externalScanPath);
    plugin.data.files = plugin.data.files.filter((entry) => entry.path !== externalScanPath);
    plugin.data.conflicts = plugin.data.conflicts.filter((conflict) => conflict.path !== externalScanPath);
    await plugin.savePluginData();
    await globalThis.app.vault.delete(externalScanFile);

    const nestedPath = "Temporary Nested Cards " + Date.now() + ".md";
    const nestedSource = [
      "# Nested cards",
      "- Parent item",
      "  - Child item",
      "    - Indented question ⇢%%oab:basic:v1%%Indented answer",
      "Nested prompts ⇢[%%oab:list:v1%%",
      "- Nested prompt ⇢%%oab:basic:v1%%Nested answer",
      "- The capital is ⟦%%oab:cloze:v1%%Berlin⟧%%oab:end:v1%%.",
      "- Energy facts",
      "  Energy is measured in ⟦%%oab:cloze:v1%%joules⟧%%oab:end:v1%%.",
      "- Plain list answer",
      "]⇠%%oab:end:v1%%"
    ].join("\\n");
    const nestedFile = await globalThis.app.vault.create(nestedPath, nestedSource);
    const nestedSummary = await plugin.syncFileGuarded(nestedFile, false);
    const nestedRegistry = plugin.data.cards.filter((card) => card.sourcePath === nestedPath);
    const indentedCard = nestedRegistry.find((card) => card.preview === "Indented question");
    const nestedBasicCard = nestedRegistry.find((card) => card.preview === "Nested prompt");
    const nestedListCard = nestedRegistry.find((card) => card.kind === "list");
    const nestedClozeCards = nestedRegistry.filter((card) => card.kind === "cloze");
    const indentedNote = indentedCard?.ankiNoteId
      ? await plugin.client().noteInfo(indentedCard.ankiNoteId)
      : undefined;
    const nestedBasicNote = nestedBasicCard?.ankiNoteId
      ? await plugin.client().noteInfo(nestedBasicCard.ankiNoteId)
      : undefined;
    const nestedClozeNotes = [];
    for (const card of nestedClozeCards) {
      if (card.ankiNoteId) nestedClozeNotes.push(await plugin.client().noteInfo(card.ankiNoteId));
    }
    const nestedCardsCreated = nestedSummary?.desiredNotes === 8 &&
      nestedRegistry.length === 5 && nestedListCard?.children.filter((child) => child.status === "active").length === 4 &&
      nestedBasicNote?.fields?.Front?.value?.includes("Nested prompt") &&
      nestedBasicNote?.fields?.Back?.value?.includes("Nested answer") &&
      !nestedListCard?.children.some((child) => child.preview?.includes("Nested answer"));
    const nestedClozeCardsCreated = nestedClozeNotes.length === 2 &&
      nestedClozeNotes.every((note) => note?.modelName === "Obsidian Flashcards - Cloze v1") &&
      nestedClozeNotes.some((note) => note?.fields?.Text?.value?.includes("{{c1::Berlin}}")) &&
      nestedClozeNotes.some((note) => note?.fields?.Text?.value?.includes("{{c1::joules}}")) &&
      nestedClozeNotes.every((note) => !note?.fields?.Text?.value?.includes("{{c0::"));
    const indentationContextRendered = indentedCard?.listContext?.join(" > ") === "Parent item > Child item" &&
      indentedNote?.fields?.Context?.value?.includes('class="list-context"') &&
      indentedNote.fields.Context.value.includes("Parent item") &&
      indentedNote.fields.Context.value.includes("Child item");
    const nestedWarningAbsent = !plugin.data.conflicts.some((conflict) =>
      conflict.path === nestedPath && conflict.code === "NESTED_CARD_IGNORED" && conflict.resolvedAt === undefined
    );

    await globalThis.app.workspace.getLeaf(false).openFile(nestedFile);
    await sleep(350);
    const openedNoteIds = [];
    const originalClientFactory = plugin.client;
    plugin.client = () => ({ guiBrowseNotes: async (ids) => openedNoteIds.push([...ids]) });
    const clickableMarker = document.querySelector('.oab-card-marker[data-oab-card-ordinal="0"]');
    const markerPresent = Boolean(clickableMarker);
    clickableMarker?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    await sleep(100);
    plugin.client = originalClientFactory;
    const markerClickOpenedCorrectCard = markerPresent &&
      openedNoteIds.length === 1 && openedNoteIds[0]?.length === 1 &&
      openedNoteIds[0]?.[0] === indentedCard?.ankiNoteId;
    const cursorCommandRemoved = !globalThis.app.commands.commands[
      "anki-bridge:open-current-card-in-anki"
    ];

    const cutSourcePath = "Temporary Cut Source " + Date.now() + ".md";
    const cutTargetPath = "Temporary Cut Target " + Date.now() + ".md";
    const cutCardSource = "Moved with progress ⇢%%oab:basic:v1%%Same answer";
    const cutSourceFile = await globalThis.app.vault.create(cutSourcePath, cutCardSource);
    await plugin.syncFileGuarded(cutSourceFile, false);
    const cutOriginal = plugin.data.cards.find((card) => card.sourcePath === cutSourcePath);
    if (!cutOriginal?.ankiNoteId) throw new Error("Cut/move setup did not create an Anki note.");
    const cutOriginalKey = cutOriginal.key;
    const cutOriginalNoteId = cutOriginal.ankiNoteId;
    const cutOriginalCardIds = await plugin.client().invoke("findCards", { query: "nid:" + cutOriginalNoteId });
    await globalThis.app.vault.modify(cutSourceFile, "Source remains, but the card was cut.");
    const cutTargetFile = await globalThis.app.vault.create(cutTargetPath, cutCardSource);
    await plugin.syncFileGuarded(cutTargetFile, false);
    const cutMoved = plugin.data.cards.find((card) => card.sourcePath === cutTargetPath);
    const cutMovedCardIds = await plugin.client().invoke("findCards", { query: "nid:" + cutOriginalNoteId });
    const cutPreservedIdentity = cutMoved === cutOriginal &&
      cutMoved?.key === cutOriginalKey && cutMoved.ankiNoteId === cutOriginalNoteId &&
      JSON.stringify(cutMovedCardIds) === JSON.stringify(cutOriginalCardIds) &&
      !plugin.data.cards.some((card) => card.sourcePath === cutSourcePath);

    const copySourcePath = "Temporary Copy Source " + Date.now() + ".md";
    const copyTargetPath = "Temporary Copy Target " + Date.now() + ".md";
    const copyCardSource = "Copied card ⇢%%oab:basic:v1%%Copied answer";
    const copySourceFile = await globalThis.app.vault.create(copySourcePath, copyCardSource);
    await plugin.syncFileGuarded(copySourceFile, false);
    const copyOriginal = plugin.data.cards.find((card) => card.sourcePath === copySourcePath);
    const copyTargetFile = await globalThis.app.vault.create(copyTargetPath, copyCardSource);
    await plugin.syncFileGuarded(copyTargetFile, false);
    const copiedCard = plugin.data.cards.find((card) => card.sourcePath === copyTargetPath);
    const copyCreatedNewIdentity = Boolean(copyOriginal?.ankiNoteId && copiedCard?.ankiNoteId) &&
      copyOriginal?.key !== copiedCard?.key && copyOriginal?.ankiNoteId !== copiedCard?.ankiNoteId;

    const temporaryFeaturePaths = [nestedPath, cutSourcePath, cutTargetPath, copySourcePath, copyTargetPath];
    const temporaryFeatureCards = plugin.data.cards.filter((card) => temporaryFeaturePaths.includes(card.sourcePath));
    const temporaryFeatureNoteIds = temporaryFeatureCards
      .flatMap((card) => [card.ankiNoteId, ...card.children.map((child) => child.ankiNoteId)])
      .filter(Boolean);
    await plugin.client().deleteNotes(temporaryFeatureNoteIds);
    plugin.data.cards = plugin.data.cards.filter((card) => !temporaryFeaturePaths.includes(card.sourcePath));
    plugin.data.files = plugin.data.files.filter((entry) => !temporaryFeaturePaths.includes(entry.path));
    plugin.data.conflicts = plugin.data.conflicts.filter((conflict) => !temporaryFeaturePaths.includes(conflict.path));
    await plugin.savePluginData();
    for (const temporaryPath of temporaryFeaturePaths) {
      const temporaryFile = globalThis.app.vault.getAbstractFileByPath(temporaryPath);
      if (temporaryFile) await globalThis.app.vault.delete(temporaryFile);
    }

    return {
      pluginLoaded: true,
      summary,
      registryCards: registry.length,
      noteIds,
      movedSummary,
      movedDeckVerified: movedDecks.length >= noteIds.length && movedDecks.every((deck) => deck === expectedMovedDeck),
      externalMoveRecovered,
      failureVisible,
      sourceLinkVerified,
      noteNameIsLink,
      redundantSourceRemoved,
      renderedCardClean,
      helpVisible,
      mediaSummary,
      imageMarkupIsHtml,
      imageOcclusionNative,
      imageOcclusionMaskPreserved,
      embeddedVisualsLinkToObsidian,
      canvasRendered,
      pdfPreviewRendered,
      visualRenderCount,
      allMediaPresent,
      mediaWarnings,
      deletionButtonVisible,
      deletionConfirmationVisible,
      confirmationInitiallyDisabled,
      clickDispatched,
      confirmationFinalText,
      deletionUiError,
      childRegistryRemoved,
      deletedListNotes,
      removedChildDeleted,
      keptChildRetained,
      deletedParentNotes,
      keptChildDeletedAfterParentConfirmation,
      deletionRegistryCleared,
      directDeleteClassified,
      directNotesRetainedBeforeConfirmation,
      directRestoreClearedPending,
      directDeleteButtonsVisible,
      directDeletedNotes,
      directAnkiNotesDeleted,
      directRegistryCleared,
      ambiguousConflictOnly,
      ambiguousAnkiNoteRetained,
      ambiguousResolutionButtonsVisible,
      ambiguousRelinked,
      deleteAllConfirmationVisible,
      externalDeleteApplied,
      mobileOutboxCreated,
      mobileOutboxUpdated,
      sharedStateAvailable,
      sharedOutboxUsed,
      legacyOutboxMigrated,
      mobileDeleteQuarantined,
      mobileConfirmedDeletionApplied,
      mobileOutboxDrained,
      externalFileScanRecovered,
      nestedCardsCreated,
      nestedClozeCardsCreated,
      indentationContextRendered,
      nestedWarningAbsent,
      markerClickOpenedCorrectCard,
      cursorCommandRemoved,
      cutPreservedIdentity,
      copyCreatedNewIdentity,
      markerDecorations: document.querySelectorAll(".oab-card-marker").length,
      fieldDecorations: document.querySelectorAll(".oab-card-field").length,
      unresolvedConflicts: plugin.data.conflicts.filter((conflict) => conflict.resolvedAt === undefined)
    };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
}
const value = result.result?.value;
const shortcutSetup = await command("Runtime.evaluate", {
  expression: `(async () => {
    const file = globalThis.app.vault.getAbstractFileByPath("Test Cards.md");
    const leaf = globalThis.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const editor = leaf.view?.editor;
    if (!editor) throw new Error("No active Markdown editor for shortcut test.");
    const original = await globalThis.app.vault.read(file);
    const candidate = original + "\\nShortcut >>";
    editor.setValue(candidate);
    editor.setCursor(editor.offsetToPos(candidate.length));
    editor.focus();
    return { original, path: file.path };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
if (shortcutSetup.exceptionDetails || !shortcutSetup.result?.value?.original) {
  throw new Error(`Shortcut setup failed: ${JSON.stringify(shortcutSetup)}`);
}
const shortcutState = shortcutSetup.result.value;
const shortcutResult = await command("Runtime.evaluate", {
  expression: `(async () => {
    const editor = globalThis.app.workspace.activeLeaf?.view?.editor;
    const codeMirror = editor?.cm;
    if (!editor || !codeMirror?.contentDOM) throw new Error("CodeMirror editor is unavailable.");
    const tabAccepted = codeMirror.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      which: 9,
      bubbles: true,
      cancelable: true
    }));
    editor.replaceSelection("Answer");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const tail = editor?.getValue().slice(-80) ?? "";
    const expanded = tail.endsWith("Shortcut ⇢%%oab:basic:v1%%Answer");
    const parsedBack = globalThis.app.plugins.plugins["anki-bridge"].parser.parse(editor.getValue()).at(-1)?.back;
    const original = ${JSON.stringify(shortcutState.original)};
    const file = globalThis.app.vault.getAbstractFileByPath(${JSON.stringify(shortcutState.path)});
    editor.setValue(original);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await globalThis.app.vault.modify(file, original);
    return { expanded, parsedBack, tail, tabPrevented: !tabAccepted };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
clearInterval(keepAlive);
value.shortcutExpansion = shortcutResult.result?.value?.expanded === true;
value.shortcutBack = shortcutResult.result?.value?.parsedBack;
value.shortcutTail = shortcutResult.result?.value?.tail;
value.shortcutDebug = shortcutResult.exceptionDetails?.exception?.description ?? shortcutResult.result?.description;
const directShortcutResult = await command("Runtime.evaluate", {
  expression: `(async () => {
    const editor = globalThis.app.workspace.activeLeaf?.view?.editor;
    const codeMirror = editor?.cm;
    const file = globalThis.app.vault.getAbstractFileByPath(${JSON.stringify(shortcutState.path)});
    if (!editor || !codeMirror?.contentDOM || !file) throw new Error("No active CodeMirror editor for direct shortcut tests.");
    const original = ${JSON.stringify(shortcutState.original)};
    const pressTab = () => !codeMirror.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      which: 9,
      bubbles: true,
      cancelable: true
    }));
    const cases = [
      { name: "reverse", suffix: "><", cursorBack: 0, content: "Definition", kind: "reverse" },
      { name: "list", suffix: ">[]", cursorBack: 1, content: "List item", kind: "list" },
      { name: "dump", suffix: ">{}", cursorBack: 1, content: "Long answer", kind: "dump" },
      { name: "image", suffix: ">!", cursorBack: 0, content: "![[diagram.png]]", kind: "image-occlusion" }
    ];
    const results = [];
    for (const candidate of cases) {
      const source = original + "\\nShortcut " + candidate.suffix;
      editor.setValue(source);
      editor.setCursor(editor.offsetToPos(source.length - candidate.cursorBack));
      editor.focus();
      const tabPrevented = pressTab();
      editor.replaceSelection(candidate.content);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const parsed = globalThis.app.plugins.plugins["anki-bridge"].parser.parse(editor.getValue()).at(-1);
      results.push({
        name: candidate.name,
        tabPrevented,
        parsedKind: parsed?.kind,
        expectedKind: candidate.kind,
        noAutoCloserLeft: candidate.cursorBack === 0 ||
          !editor.getValue().includes(candidate.suffix + candidate.suffix.at(-1))
      });
    }

    const clozeSource = original + "\\nThe capital is []";
    editor.setValue(clozeSource);
    editor.setCursor(editor.offsetToPos(clozeSource.length - 1));
    editor.focus();
    const clozeTabPrevented = pressTab();
    editor.replaceSelection("Berlin");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const beforeMove = codeMirror.state.selection.main.head;
    const moved = codeMirror.moveByChar(codeMirror.state.selection.main, true);
    codeMirror.dispatch({ selection: { anchor: moved.head } });
    editor.replaceSelection(" aaron");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const clozeValue = editor.getValue();
    const clozeParsed = globalThis.app.plugins.plugins["anki-bridge"].parser.parse(clozeValue).at(-1);
    const closeMarker = "⟧%%oab:end:v1%%";
    const closeEnd = clozeValue.indexOf(closeMarker, clozeValue.lastIndexOf("The capital is")) + closeMarker.length;
    const cloze = {
      tabPrevented: clozeTabPrevented,
      parsedKind: clozeParsed?.kind,
      parsedFront: clozeParsed?.front,
      cursorSkippedMarker: moved.head > beforeMove && moved.head === closeEnd,
      continuedInOrder: clozeValue.endsWith(closeMarker + " aaron"),
      noExtraCloser: !clozeValue.endsWith(closeMarker + "] aaron")
    };
    editor.setValue(original);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await globalThis.app.vault.modify(file, original);
    return { cases: results, cloze };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
value.directShortcuts = directShortcutResult.result?.value;
value.directShortcutsDebug = directShortcutResult.exceptionDetails?.exception?.description ?? directShortcutResult.result?.description;
const touchPickerResult = await command("Runtime.evaluate", {
  expression: `(async () => {
    const editor = globalThis.app.workspace.activeLeaf?.view?.editor;
    const file = globalThis.app.vault.getAbstractFileByPath(${JSON.stringify(shortcutState.path)});
    if (!editor || !file) throw new Error("No active Markdown editor for touch picker test.");
    const original = ${JSON.stringify(shortcutState.original)};
    const candidate = original + "\\nMobile prompt ";
    editor.setValue(candidate);
    editor.setCursor(editor.offsetToPos(candidate.length));
    editor.focus();
    const commandId = "anki-bridge:insert-flashcard";
    const registeredCommand = globalThis.app.commands.commands[commandId];
    const ribbonVisible = Boolean(document.querySelector('[aria-label="Insert Anki flashcard"]'));
    const executed = globalThis.app.commands.executeCommandById(commandId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const picker = document.querySelector(".oab-card-picker");
    const choices = [...(picker?.querySelectorAll(".suggestion-item") ?? [])];
    const basic = choices.find((choice) => choice.textContent?.includes("Basic card"));
    basic?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    editor.replaceSelection("Mobile answer");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tail = editor.getValue().slice(-100);
    const parsed = globalThis.app.plugins.plugins["anki-bridge"].parser.parse(editor.getValue()).at(-1);
    editor.setValue(original);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await globalThis.app.vault.modify(file, original);
    return {
      commandRegistered: Boolean(registeredCommand),
      commandHasIcon: registeredCommand?.icon === "plus-circle",
      ribbonVisible,
      executed,
      pickerVisible: Boolean(picker),
      choiceCount: choices.length,
      inserted: tail.endsWith("Mobile prompt ⇢%%oab:basic:v1%%Mobile answer"),
      parsedKind: parsed?.kind,
      parsedBack: parsed?.back,
      tail
    };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
value.touchPicker = touchPickerResult.result?.value;
value.touchPickerDebug = touchPickerResult.exceptionDetails?.exception?.description ?? touchPickerResult.result?.description;
socket.close();
if (!value?.pluginLoaded || value.summary?.desiredNotes !== 7 || value.noteIds?.length !== 7 ||
    !value.movedDeckVerified || !value.externalMoveRecovered || !value.failureVisible ||
    !value.sourceLinkVerified || !value.noteNameIsLink || !value.redundantSourceRemoved ||
    !value.renderedCardClean || !value.helpVisible || value.mediaSummary?.desiredNotes !== 3 ||
    !value.imageMarkupIsHtml || !value.imageOcclusionNative || !value.imageOcclusionMaskPreserved ||
    !value.embeddedVisualsLinkToObsidian || !value.canvasRendered ||
    !value.pdfPreviewRendered || value.visualRenderCount < 2 || !value.allMediaPresent ||
    !value.deletionButtonVisible ||
    !value.deletionConfirmationVisible || value.confirmationInitiallyDisabled || !value.clickDispatched ||
    value.deletedListNotes !== 1 || !value.childRegistryRemoved || value.deletionUiError ||
    !value.removedChildDeleted || !value.keptChildRetained || value.deletedParentNotes !== 1 ||
    !value.keptChildDeletedAfterParentConfirmation || !value.deletionRegistryCleared ||
    !value.directDeleteClassified || !value.directNotesRetainedBeforeConfirmation ||
    !value.directRestoreClearedPending || !value.directDeleteButtonsVisible ||
    value.directDeletedNotes !== 2 || !value.directAnkiNotesDeleted || !value.directRegistryCleared ||
    !value.ambiguousConflictOnly || !value.ambiguousAnkiNoteRetained ||
    !value.ambiguousResolutionButtonsVisible || !value.ambiguousRelinked ||
    !value.deleteAllConfirmationVisible || !value.externalDeleteApplied ||
    !value.mobileOutboxCreated || !value.mobileOutboxUpdated || !value.sharedStateAvailable ||
    !value.sharedOutboxUsed || !value.legacyOutboxMigrated || !value.mobileDeleteQuarantined ||
    !value.mobileConfirmedDeletionApplied || !value.mobileOutboxDrained ||
    !value.externalFileScanRecovered || !value.nestedCardsCreated || !value.nestedClozeCardsCreated ||
    !value.indentationContextRendered || !value.nestedWarningAbsent ||
    !value.markerClickOpenedCorrectCard || !value.cursorCommandRemoved ||
    !value.cutPreservedIdentity || !value.copyCreatedNewIdentity ||
    !value.shortcutExpansion || value.shortcutBack !== "Answer" ||
    value.directShortcuts?.cases?.length !== 4 ||
    !value.directShortcuts.cases.every((entry) => entry.tabPrevented &&
      entry.parsedKind === entry.expectedKind && entry.noAutoCloserLeft) ||
    !value.directShortcuts?.cloze?.tabPrevented ||
    value.directShortcuts.cloze.parsedKind !== "cloze" ||
    value.directShortcuts.cloze.parsedFront !== "The capital is {{c1::Berlin}} aaron" ||
    !value.directShortcuts.cloze.cursorSkippedMarker ||
    !value.directShortcuts.cloze.continuedInOrder || !value.directShortcuts.cloze.noExtraCloser ||
    !value.touchPicker?.commandRegistered || !value.touchPicker.commandHasIcon ||
    !value.touchPicker.ribbonVisible || !value.touchPicker.executed ||
    !value.touchPicker.pickerVisible || value.touchPicker.choiceCount !== 6 ||
    !value.touchPicker.inserted || value.touchPicker.parsedKind !== "basic" ||
    value.touchPicker.parsedBack !== "Mobile answer") {
  throw new Error(`Unexpected Obsidian smoke-test result: ${JSON.stringify(value)}`);
}
if (value.markerDecorations < 5 || value.fieldDecorations < 8) {
  throw new Error(`Editor decorations are incomplete: ${JSON.stringify(value)}`);
}
if (value.unresolvedConflicts.length !== 0) {
  throw new Error(`Smoke test produced conflicts: ${JSON.stringify(value.unresolvedConflicts)}`);
}
process.stdout.write(JSON.stringify({ ok: true, ...value }) + "\n");
