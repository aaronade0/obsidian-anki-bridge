import type { App } from "obsidian";
import { describe, expect, it } from "vitest";
import type { AnkiConnectClient } from "../src/anki-connect";
import { buildDesiredNotes } from "../src/desired-notes";
import { FlashcardParser } from "../src/parser";
import type { RegistryCard } from "../src/types";
import { TFile } from "./stubs/obsidian";

const vaultFiles = ["Physik/Dissipation.md", "Physik/Energie.md", "Physik/Wärme.md"];

const app = {
  metadataCache: {
    getFirstLinkpathDest: (linkpath: string) => {
      const candidate = linkpath.endsWith(".md") ? linkpath : `${linkpath}.md`;
      const match = vaultFiles.find((path) => path === candidate || path.endsWith(`/${candidate}`));
      return match ? new TFile(match) : null;
    }
  }
} as unknown as App;

const mediaStore = {
  storeMediaFile: async (filename: string) => filename
} as unknown as AnkiConnectClient;

function registryFor(ordinal: number, key: string): RegistryCard {
  return {
    key,
    ordinal,
    sourcePath: "Physik/Dissipation.md",
    fingerprint: "fingerprint",
    status: "active",
    children: [],
    startOffset: 0,
    endOffset: 0
  } as unknown as RegistryCard;
}

async function notesFor(source: string) {
  const parsed = new FlashcardParser().parse(source);
  const registry = parsed.map((_, index) => registryFor(index, `card_${index}`));
  const { notes } = await buildDesiredNotes(
    app,
    mediaStore,
    "My Vault",
    "Physik/Dissipation.md",
    "Anki::Physik",
    parsed,
    registry
  );
  return notes;
}

describe("cards built for Anki", () => {
  it("turns Obsidian links in card content into links back into the vault", async () => {
    const [note] = await notesFor(
      "Was ist Dissipation? ⇢%%oab:basic:v1%% Umwandlung von [[Energie]] in [[Wärme]] durch [[Widerstand|Widerstände]]"
    );

    expect(note?.fields.Back).toContain(
      '<a class="oab-link" href="obsidian://anki-bridge?vault=My%20Vault&amp;link=Energie'
      + '&amp;source=Physik%2FDissipation.md">Energie</a>'
    );
    expect(note?.fields.Back).toContain(">Wärme</a>");
    // The alias is shown, the note it points at is unknown, so it is marked.
    expect(note?.fields.Back).toContain('class="oab-link is-unresolved"');
    expect(note?.fields.Back).toContain(">Widerstände</a>");
    expect(note?.fields.Back).not.toContain("[[");
  });

  it("shows only the question side of an enclosing card in the context", async () => {
    const [, note] = await notesFor([
      "# [[Dissipation]]",
      "## Herleitung [[Energie]] ⇢%%oab:basic:v1%% ![[Skizze.png]] #prio2",
      "Wodurch entsteht sie? ⇢%%oab:basic:v1%% Durch Reibung",
      ""
    ].join("\n"));

    const context = note?.fields.Context ?? "";
    expect(context).toContain("Herleitung ");
    expect(context).toContain(">Energie</a>");
    // Neither the answer of the heading card nor the note title repeats itself.
    expect(context).not.toContain("Skizze");
    expect(context).not.toContain("oab:");
    expect(context).not.toContain("prio2");
    expect(context).not.toContain(">Dissipation</span>");
  });

  it("masks a cloze deletion that sits in the surrounding heading", async () => {
    const [, note] = await notesFor([
      "# Reibung wandelt Energie in ⟦%%oab:cloze:v1%%Wärme⟧%%oab:end:v1%% um",
      "Wie heißt der Vorgang? ⇢%%oab:basic:v1%% Dissipation",
      ""
    ].join("\n"));

    expect(note?.fields.Context).toContain("Reibung wandelt Energie in […] um");
    expect(note?.fields.Context).not.toContain("Wärme");
  });
});
