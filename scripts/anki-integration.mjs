import process from "node:process";

const endpoint = process.env.OAB_ANKI_TEST_URL ?? "http://127.0.0.1:18765";
if (/:(?:8765)(?:\/|$)/.test(endpoint)) {
  throw new Error("Refusing to run integration tests against the production AnkiConnect port 8765.");
}

async function invoke(action, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, version: 6, params })
  });
  if (!response.ok) {
    throw new Error(`${action}: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`${action}: ${body.error}`);
  }
  return body.result;
}

const modelName = "Obsidian Flashcards - Integration v1";
const imageOcclusionModel = "Image Occlusion";
const deckA = "OAB Integration Test::Before Move";
const deckB = "OAB Integration Test::After Move";
const names = await invoke("modelNames");
if (!names.includes(modelName)) {
  await invoke("createModel", {
    modelName,
    inOrderFields: ["CardKey", "Front", "Back"],
    css: ".card { font-family: sans-serif; }",
    isCloze: false,
    cardTemplates: [{ Name: "Card", Front: "{{Front}}", Back: "{{FrontSide}}<hr>{{Back}}" }]
  });
}
if (!names.includes(imageOcclusionModel)) {
  throw new Error("The isolated Anki collection is missing its built-in Image Occlusion note type.");
}
await invoke("createDeck", { deck: deckA });
await invoke("createDeck", { deck: deckB });
const cardKey = `integration_${Date.now()}`;
const noteId = await invoke("addNote", {
  note: {
    deckName: deckA,
    modelName,
    fields: { CardKey: cardKey, Front: "Question", Back: "First answer" },
    tags: ["oab-integration"],
    options: { allowDuplicate: false }
  }
});
if (!Number.isInteger(noteId)) {
  throw new Error("addNote did not return a note ID.");
}
await invoke("updateNoteFields", { note: { id: noteId, fields: { Back: "Updated answer" } } });
const cards = await invoke("findCards", { query: `nid:${noteId}` });
await invoke("changeDeck", { cards, deck: deckB });
const info = (await invoke("notesInfo", { notes: [noteId] }))[0];
const cardInfo = (await invoke("cardsInfo", { cards }))[0];
if (info?.fields?.Back?.value !== "Updated answer" || cardInfo?.deckName !== deckB) {
  throw new Error("Anki update or deck move verification failed.");
}
await invoke("deleteNotes", { notes: [noteId] });

const migrationKey = `migration_${Date.now()}`;
const migrationNoteId = await invoke("addNote", {
  note: {
    deckName: deckA,
    modelName,
    fields: { CardKey: migrationKey, Front: "Label the image", Back: "old image field" },
    tags: ["oab-integration", `oab-id-${migrationKey}`],
    options: { allowDuplicate: false }
  }
});
const migrationCardsBefore = await invoke("findCards", { query: `nid:${migrationNoteId}` });
await invoke("updateNoteModel", {
  note: {
    id: migrationNoteId,
    modelName: imageOcclusionModel,
    fields: {
      Occlusion: "{{c1::image-occlusion:rect:left=.0:top=.0:width=1:height=1}}",
      Image: '<img src="integration.png">',
      Header: "Label the image",
      "Back Extra": "",
      Comments: ""
    },
    tags: ["oab-integration", `oab-id-${migrationKey}`]
  }
});
const migrationInfo = (await invoke("notesInfo", { notes: [migrationNoteId] }))[0];
const migrationCardsAfter = await invoke("findCards", { query: `nid:${migrationNoteId}` });
if (migrationInfo?.modelName !== imageOcclusionModel ||
    migrationInfo?.fields?.Occlusion?.value !== "{{c1::image-occlusion:rect:left=.0:top=.0:width=1:height=1}}" ||
    JSON.stringify(migrationCardsBefore) !== JSON.stringify(migrationCardsAfter)) {
  throw new Error("Native Image Occlusion migration did not preserve note/card identity.");
}
const editedMask = "{{c7::image-occlusion:rect:left=.2:top=.3:width=.4:height=.1}}";
await invoke("updateNoteFields", { note: { id: migrationNoteId, fields: { Occlusion: editedMask } } });
await invoke("updateNoteFields", {
  note: { id: migrationNoteId, fields: { Image: '<img src="updated-integration.png">', Header: "Updated label" } }
});
const afterOwnedUpdate = (await invoke("notesInfo", { notes: [migrationNoteId] }))[0];
if (afterOwnedUpdate?.fields?.Occlusion?.value !== editedMask) {
  throw new Error("A bridge-owned field update overwrote the native Image Occlusion mask.");
}
await invoke("deleteNotes", { notes: [migrationNoteId] });
process.stdout.write(JSON.stringify({
  ok: true,
  endpoint,
  createdUpdatedMovedAndRemovedTestNote: noteId,
  nativeImageOcclusionMigrationPreservedCard: migrationCardsBefore[0]
}) + "\n");
