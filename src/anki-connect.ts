import { requestUrl } from "obsidian";
import { noteBelongsToCardKey, ownershipTag } from "./ownership";

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

export interface AnkiNoteInput {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

export interface AnkiNoteInfo {
  noteId: number;
  cards: number[];
  fields: Record<string, { value: string; order: number }>;
  modelName: string;
  tags: string[];
}

export const STANDARD_MODEL = "Obsidian Flashcards - Standard v1";
export const CLOZE_MODEL = "Obsidian Flashcards - Cloze v1";
export const IMAGE_OCCLUSION_MODEL = "Image Occlusion";
const IMAGE_OCCLUSION_FIELDS = ["Occlusion", "Image", "Header", "Back Extra", "Comments"];

export class AnkiConnectClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string
  ) {}

  async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const payload: Record<string, unknown> = { action, version: 6, params };
    if (this.apiKey.trim()) {
      payload.key = this.apiKey.trim();
    }
    let response;
    try {
      response = await requestUrl({
        url: this.url,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(payload),
        throw: false
      });
    } catch (error) {
      throw new Error(`AnkiConnect ist unter ${this.url} nicht erreichbar: ${errorMessage(error)}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AnkiConnect antwortete mit HTTP ${response.status}.`);
    }
    const body = response.json as AnkiResponse<T>;
    if (!body || !("error" in body)) {
      throw new Error("AnkiConnect returned an invalid API response.");
    }
    if (body.error) {
      throw new Error(`AnkiConnect: ${body.error}`);
    }
    return body.result;
  }

  async ping(): Promise<number> {
    return this.invoke<number>("version");
  }

  async ensureModels(): Promise<void> {
    const models = await this.invoke<string[]>("modelNames");
    if (!models.includes(STANDARD_MODEL)) {
      await this.invoke("createModel", {
        modelName: STANDARD_MODEL,
        inOrderFields: ["CardKey", "Kind", "Front", "Back", "Context", "Source", "Reverse", "Extra"],
        css: CARD_CSS,
        isCloze: false,
        cardTemplates: STANDARD_TEMPLATES
      });
    } else {
      await this.invoke("updateModelStyling", { model: { name: STANDARD_MODEL, css: CARD_CSS } });
      await this.invoke("updateModelTemplates", {
        model: { name: STANDARD_MODEL, templates: templateMap(STANDARD_TEMPLATES) }
      });
    }

    if (!models.includes(CLOZE_MODEL)) {
      await this.invoke("createModel", {
        modelName: CLOZE_MODEL,
        inOrderFields: ["CardKey", "Text", "Context", "Source", "Extra"],
        css: CARD_CSS,
        isCloze: true,
        cardTemplates: CLOZE_TEMPLATES
      });
    } else {
      await this.invoke("updateModelStyling", { model: { name: CLOZE_MODEL, css: CARD_CSS } });
      await this.invoke("updateModelTemplates", {
        model: { name: CLOZE_MODEL, templates: templateMap(CLOZE_TEMPLATES) }
      });
    }
  }

  async assertImageOcclusionModel(): Promise<void> {
    const models = await this.invoke<string[]>("modelNames");
    if (!models.includes(IMAGE_OCCLUSION_MODEL)) {
      throw new Error(
        `Anki's native “${IMAGE_OCCLUSION_MODEL}” note type is missing. Add the built-in Image Occlusion note type in Anki, then synchronize again.`
      );
    }
    const fields = await this.invoke<string[]>("modelFieldNames", { modelName: IMAGE_OCCLUSION_MODEL });
    const missing = IMAGE_OCCLUSION_FIELDS.filter((field) => !fields.includes(field));
    if (missing.length > 0) {
      throw new Error(
        `Anki's “${IMAGE_OCCLUSION_MODEL}” note type is missing required field(s): ${missing.join(", ")}. Restore the built-in note type, then synchronize again.`
      );
    }
    const templates = await this.invoke<Record<string, { Front: string; Back: string }>>("modelTemplates", {
      modelName: IMAGE_OCCLUSION_MODEL
    });
    const templateSource = JSON.stringify(templates);
    if (!templateSource.includes("anki.imageOcclusion.setup()") || !templateSource.includes("image-occlusion-canvas")) {
      throw new Error(
        `Anki's “${IMAGE_OCCLUSION_MODEL}” note type does not use the built-in Image Occlusion review template. Restore the native note type, then synchronize again.`
      );
    }
  }

  async ensureDeck(deckName: string): Promise<void> {
    await this.invoke<number>("createDeck", { deck: deckName });
  }

  async addNote(note: AnkiNoteInput): Promise<number> {
    return this.invoke<number>("addNote", {
      note: {
        deckName: note.deckName,
        modelName: note.modelName,
        fields: note.fields,
        tags: note.tags,
        // Native Image Occlusion notes start with the same temporary full-image
        // mask. Anki's duplicate check only examines that first field.
        options: { allowDuplicate: note.modelName === IMAGE_OCCLUSION_MODEL },
        audio: [],
        video: [],
        picture: []
      }
    });
  }

  async findNoteByCardKey(cardKey: string): Promise<number | undefined> {
    const ids = await this.findNoteIdsByCardKey(cardKey);
    return ids.length === 1 ? ids[0] : undefined;
  }

  async findNoteIdsByCardKey(cardKey: string): Promise<number[]> {
    const [fieldIds, tagIds] = await Promise.all([
      this.invoke<number[]>("findNotes", { query: `CardKey:${cardKey}` }),
      this.invoke<number[]>("findNotes", { query: `tag:${ownershipTag(cardKey)}` })
    ]);
    const ids = [...new Set([...fieldIds, ...tagIds])];
    if (ids.length === 0) {
      return [];
    }
    const infos = await this.invoke<AnkiNoteInfo[]>("notesInfo", { notes: ids });
    return infos
      .filter((info) => noteBelongsToCardKey(info, cardKey))
      .map((info) => info.noteId);
  }

  async noteInfo(noteId: number): Promise<AnkiNoteInfo | undefined> {
    const notes = await this.invoke<AnkiNoteInfo[]>("notesInfo", { notes: [noteId] });
    const note = notes[0];
    // Some AnkiConnect versions return an empty object for a deleted note ID
    // instead of omitting it. Treat only a complete note record as existing.
    return note && Number.isInteger(note.noteId) ? note : undefined;
  }

  async updateNote(noteId: number, fields: Record<string, string>, tags: string[]): Promise<void> {
    await this.invoke("updateNoteFields", { note: { id: noteId, fields } });
    await this.invoke("removeTags", { notes: [noteId], tags: "prio1 prio2 prio3 prio4 oab-prio1 oab-prio2 oab-prio3 oab-prio4" });
    if (tags.length > 0) {
      await this.invoke("addTags", { notes: [noteId], tags: tags.join(" ") });
    }
  }

  async migrateNoteModel(noteId: number, note: AnkiNoteInput, existingTags: string[]): Promise<void> {
    const retainedTags = existingTags.filter((tag) => !/^(?:prio|oab-prio)[1-4]$/.test(tag));
    const tags = [...new Set([...retainedTags, ...note.tags])];
    try {
      await this.invoke("updateNoteModel", {
        note: {
          id: noteId,
          modelName: note.modelName,
          fields: note.fields,
          tags
        }
      });
    } catch (error) {
      throw new Error(
        "This AnkiConnect installation cannot safely migrate the existing card to native Image Occlusion while retaining its card ID and review history. Convert that note to the native Image Occlusion type manually in Anki or use an AnkiConnect build that provides updateNoteModel, then synchronize again. " +
        `Original error: ${errorMessage(error)}`
      );
    }
  }

  async deleteNotes(noteIds: number[]): Promise<void> {
    if (noteIds.length > 0) {
      await this.invoke("deleteNotes", { notes: noteIds });
    }
  }

  async moveNoteToDeck(noteId: number, deckName: string): Promise<boolean> {
    const cardIds = await this.invoke<number[]>("findCards", { query: `nid:${noteId}` });
    if (cardIds.length === 0) {
      return false;
    }
    const infos = await this.invoke<Array<{ deckName: string }>>("cardsInfo", { cards: cardIds });
    if (infos.every((info) => info.deckName === deckName)) {
      return false;
    }
    await this.invoke("changeDeck", { cards: cardIds, deck: deckName });
    return true;
  }

  async storeMediaFile(filename: string, data: string): Promise<string> {
    return this.invoke<string>("storeMediaFile", { filename, data });
  }

  async guiBrowseNotes(noteIds: number[]): Promise<void> {
    const uniqueIds = [...new Set(noteIds)].filter(Number.isSafeInteger);
    if (uniqueIds.length === 0) {
      return;
    }
    await this.invoke("guiBrowse", { query: uniqueIds.map((noteId) => `nid:${noteId}`).join(" OR ") });
  }
}

const STANDARD_TEMPLATES = [
  {
    Name: "Obsidian → Anki",
    Front: `<div class="oab-context">{{Context}}</div><main>{{Front}}</main>`,
    Back: `{{FrontSide}}<hr id="answer"><main>{{Back}}</main>`
  },
  {
    Name: "Anki → Obsidian",
    Front: `{{#Reverse}}<div class="oab-context">{{Context}}</div><main>{{Back}}</main>{{/Reverse}}`,
    Back: `{{#Reverse}}{{FrontSide}}<hr id="answer"><main>{{Front}}</main>{{/Reverse}}`
  }
];

const CLOZE_TEMPLATES = [
  {
    Name: "Cloze",
    Front: `<div class="oab-context">{{Context}}</div><main>{{cloze:Text}}</main>`,
    Back: `<div class="oab-context">{{Context}}</div><main>{{cloze:Text}}</main>`
  }
];

const CARD_CSS = `
.card { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 20px; line-height: 1.5; color: #242424; background: #fff; padding: 24px; }
.nightMode .card { color: #e8e8e8; background: #1e1e1e; }
.oab-context { color: #777; font-size: .72em; margin-bottom: 1.2rem; }
.oab-context .note { color: #7c3aed; font-size: 1.25em; font-weight: 600; }
.oab-context .heading { display: block; margin-left: calc(var(--depth, 0) * .7rem); font-size: calc(1em - var(--depth, 0) * .04em); }
.oab-context .list-context { display: block; margin-left: calc((var(--depth, 0) + 1) * .7rem); font-size: .96em; }
.oab-context .list-bullet { display: inline-block; width: 1.1em; opacity: .72; }
main img, main video { display: block; max-width: 100%; height: auto; margin: .75rem auto; }
main audio { width: 100%; }
main figure { margin: 1rem 0; }
main figcaption { margin-top: .35rem; font-size: .75em; text-align: center; opacity: .75; }
.oab-embedded-link { display: block; cursor: pointer; }
.oab-embedded-link img { cursor: pointer; }
.oab-embedded-file { color: #7c3aed; }
main table { width: 100%; border-collapse: collapse; }
main th, main td { border: 1px solid #aaa; padding: .35rem .5rem; }
main pre { overflow-x: auto; padding: .8rem; border-radius: .4rem; background: rgba(127,127,127,.12); }
.oab-context a.note { text-decoration: none; }
.cloze { color: #7c3aed; font-weight: 700; }
`;

function templateMap(templates: Array<{ Name: string; Front: string; Back: string }>): Record<string, { Front: string; Back: string }> {
  return Object.fromEntries(templates.map((template) => [template.Name, { Front: template.Front, Back: template.Back }]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
