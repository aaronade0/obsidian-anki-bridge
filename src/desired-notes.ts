import type { App } from "obsidian";
import {
  CLOZE_MODEL,
  IMAGE_OCCLUSION_MODEL,
  STANDARD_MODEL,
  type AnkiConnectClient
} from "./anki-connect";
import { sourceContext } from "./deck";
import { renderForAnki } from "./render";
import { ownershipTag } from "./ownership";
import { renderContext, sourceHref } from "./source-link";
import type { DesiredAnkiNote, ParsedCard, RegistryCard } from "./types";
import type { VisualRenderer } from "./visual-renderer";

export interface DesiredNotesResult {
  notes: DesiredAnkiNote[];
  warnings: Array<{ cardKey: string; message: string }>;
}

export async function buildDesiredNotes(
  app: App,
  mediaStore: AnkiConnectClient,
  vaultName: string,
  sourcePath: string,
  deckName: string,
  parsedCards: ParsedCard[],
  registryCards: RegistryCard[],
  visualRenderer?: VisualRenderer
): Promise<DesiredNotesResult> {
  const notes: DesiredAnkiNote[] = [];
  const warnings: Array<{ cardKey: string; message: string }> = [];

  for (const parsed of parsedCards) {
    const registry = registryCards.find((card) => card.ordinal === parsed.ordinal && card.status === "active");
    if (!registry) {
      continue;
    }
    const context = sourceContext(sourcePath, parsed.headingPath, parsed.listContext);
    const priorityTags = parsed.priority ? [`prio${parsed.priority}`, `oab-prio${parsed.priority}`] : [];

    if (parsed.kind === "cloze") {
      const contextHtml = renderContext(
        context.folderPath,
        context.noteName,
        context.headingPath,
        sourceHref(vaultName, registry.key),
        context.listContext
      );
      const rendered = await renderForAnki(
        app,
        mediaStore,
        sourcePath,
        parsed.front,
        visualRenderer,
        { vaultName, sourceHref: sourceHref(vaultName, registry.key) }
      );
      warnings.push(...rendered.warnings.map((message) => ({ cardKey: registry.key, message })));
      notes.push({
        cardKey: registry.key,
        parentCardKey: registry.key,
        modelName: CLOZE_MODEL,
        deckName,
        fields: {
          CardKey: registry.key,
          Text: rendered.html,
          Context: contextHtml,
          Source: "",
          Extra: ""
        },
        tags: ["oab", ...priorityTags],
        ownedFields: ["CardKey", "Text", "Context", "Source", "Extra"],
        existingNoteId: registry.ankiNoteId
      });
      continue;
    }

    if (parsed.kind === "list") {
      const renderedPrompt = await renderForAnki(
        app,
        mediaStore,
        sourcePath,
        parsed.front,
        visualRenderer,
        { vaultName, sourceHref: sourceHref(vaultName, registry.key) }
      );
      warnings.push(...renderedPrompt.warnings.map((message) => ({ cardKey: registry.key, message })));
      for (const [itemOrdinal, item] of parsed.items.entries()) {
        const child = registry.children.find(
          (candidate) => candidate.status === "active" && candidate.ordinal === itemOrdinal
        );
        if (!child) {
          continue;
        }
        const renderedItem = await renderForAnki(
          app,
          mediaStore,
          sourcePath,
          item,
          visualRenderer,
          { vaultName, sourceHref: sourceHref(vaultName, child.key) }
        );
        warnings.push(...renderedItem.warnings.map((message) => ({ cardKey: child.key, message })));
        const contextHtml = renderContext(
          context.folderPath,
          context.noteName,
          context.headingPath,
          sourceHref(vaultName, child.key),
          context.listContext
        );
        notes.push({
          cardKey: child.key,
          parentCardKey: registry.key,
          modelName: STANDARD_MODEL,
          deckName,
          fields: standardFields(
            child.key,
            "list",
            `${renderedPrompt.html}<div class="oab-list-index">Element ${itemOrdinal + 1} von ${parsed.items.length}</div>`,
            renderedItem.html,
            contextHtml,
            "",
            false
          ),
          tags: ["oab", "oab-list", ...priorityTags],
          ownedFields: standardOwnedFields,
          existingNoteId: child.ankiNoteId
        });
      }
      continue;
    }

    const cardSourceHref = sourceHref(vaultName, registry.key);
    const renderedFront = await renderForAnki(
      app,
      mediaStore,
      sourcePath,
      parsed.front,
      visualRenderer,
      { vaultName, sourceHref: cardSourceHref }
    );
    const renderedBack = await renderForAnki(
      app,
      mediaStore,
      sourcePath,
      parsed.back,
      visualRenderer,
      { vaultName, sourceHref: cardSourceHref }
    );
    const contextHtml = renderContext(
      context.folderPath,
      context.noteName,
      context.headingPath,
      sourceHref(vaultName, registry.key),
      context.listContext
    );
    warnings.push(
      ...[...renderedFront.warnings, ...renderedBack.warnings].map((message) => ({ cardKey: registry.key, message }))
    );
    if (parsed.kind === "image-occlusion") {
      notes.push({
        cardKey: registry.key,
        parentCardKey: registry.key,
        modelName: IMAGE_OCCLUSION_MODEL,
        deckName,
        fields: {
          Occlusion: "{{c1::image-occlusion:rect:left=.0:top=.0:width=1:height=1}}",
          Image: renderedBack.html,
          Header: `${contextHtml}<div class="oab-io-prompt">${renderedFront.html}</div>`,
          "Back Extra": "",
          Comments: ""
        },
        tags: ["oab", "oab-image-occlusion", ownershipTag(registry.key), ...priorityTags],
        ownedFields: ["Image", "Header"],
        existingNoteId: registry.ankiNoteId
      });
      continue;
    }

    notes.push({
      cardKey: registry.key,
      parentCardKey: registry.key,
      modelName: STANDARD_MODEL,
      deckName,
      fields: standardFields(
        registry.key,
        parsed.kind,
        renderedFront.html,
        renderedBack.html,
        contextHtml,
        "",
        parsed.kind === "reverse"
      ),
      tags: ["oab", `oab-${parsed.kind}`, ...priorityTags],
      ownedFields: standardOwnedFields,
      existingNoteId: registry.ankiNoteId
    });
  }

  return { notes, warnings };
}

const standardOwnedFields = ["CardKey", "Kind", "Front", "Back", "Context", "Source", "Reverse", "Extra"];

function standardFields(
  cardKey: string,
  kind: string,
  front: string,
  back: string,
  context: string,
  source: string,
  reverse: boolean
): Record<string, string> {
  return {
    CardKey: cardKey,
    Kind: kind,
    Front: front,
    Back: back,
    Context: context,
    Source: source,
    Reverse: reverse ? "1" : "",
    Extra: ""
  };
}
