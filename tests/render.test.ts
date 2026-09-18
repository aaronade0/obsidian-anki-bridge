import { describe, expect, it } from "vitest";
import { noteBelongsToCardKey, ownershipTag, type OwnedNoteInfo } from "../src/ownership";
import type { App } from "obsidian";
import { renderForAnki, type MediaStore } from "../src/render";
import { fileHref, renderContext, sourceHref } from "../src/source-link";
import type { VisualRenderer } from "../src/visual-renderer";
import { TFile } from "./stubs/obsidian";

describe("Anki source context", () => {
  it("makes only the note name the Obsidian link", () => {
    const href = sourceHref("My Vault", "card_123");
    const context = renderContext("School/Physics", "Motion", ["Mechanics"], href);

    expect(href).toBe("obsidian://anki-bridge?vault=My%20Vault&card=card_123");
    expect(context).toContain('<span class="folder">School/Physics</span><span class="path-separator">/</span>');
    expect(context).toContain(
      '<a class="note" href="obsidian://anki-bridge?vault=My%20Vault&amp;card=card_123">Motion</a>'
    );
    expect(context).not.toContain("In Obsidian öffnen");
  });

  it("renders indented list ancestors as context without interpreting HTML", () => {
    const context = renderContext(
      "School/Physics",
      "Motion",
      ["Mechanics"],
      sourceHref("My Vault", "card_123"),
      ["Forces & motion", "<unsafe>"]
    );

    expect(context).toContain('<span class="context-item list-context" style="--depth:1;--distance:1">');
    expect(context).toContain('<span class="context-item list-context is-nearest" style="--depth:2;--distance:0">');
    expect(context).toContain("Forces &amp; motion");
    expect(context).toContain("&lt;unsafe&gt;");
    expect(context).not.toContain("<unsafe>");
  });

  it("emphasizes the context nearest to the card", () => {
    const context = renderContext(
      "Study",
      "Physics",
      ["Kinematics", "Velocity"],
      sourceHref("My Vault", "card_123")
    );

    expect(context).toContain('class="context-item heading" style="--depth:0;--distance:1"');
    expect(context).toContain('class="context-item heading is-nearest" style="--depth:1;--distance:0"');
    expect(context.indexOf("Kinematics")).toBeLessThan(context.indexOf("Velocity"));
  });

  it("creates an Obsidian file link for embedded visuals", () => {
    expect(fileHref("My Vault", "Drawings/Force diagram.excalidraw.md")).toBe(
      "obsidian://open?vault=My%20Vault&file=Drawings%2FForce%20diagram.excalidraw.md"
    );
  });

  it("recognizes bridge ownership in both managed and native note types", () => {
    const standard = {
      fields: { CardKey: { value: "card_123", order: 0 } },
      tags: []
    } as unknown as OwnedNoteInfo;
    const native = {
      fields: { Image: { value: "image.png", order: 1 } },
      tags: [ownershipTag("card_123")]
    } as unknown as OwnedNoteInfo;

    expect(ownershipTag("card_123")).toBe("oab-id-card_123");
    expect(noteBelongsToCardKey(standard, "card_123")).toBe(true);
    expect(noteBelongsToCardKey(native, "card_123")).toBe(true);
    expect(noteBelongsToCardKey(native, "card_other")).toBe(false);
  });
});

describe("PDF embeds", () => {
  const pdfFile = new TFile("School/Elementares Rechnen Mengen und Zahlen.pdf");

  function harness(): { app: App; mediaStore: MediaStore; calls: (number | undefined)[]; renderer: VisualRenderer } {
    const calls: (number | undefined)[] = [];
    const app = {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) =>
          linkpath.trim() === "Elementares Rechnen Mengen und Zahlen.pdf" ? pdfFile : null
      },
      vault: { readBinary: async () => new ArrayBuffer(8) }
    } as unknown as App;
    const mediaStore: MediaStore = { storeMediaFile: async (filename) => filename };
    const renderer = {
      renderMarkdown: async () => undefined,
      renderCanvas: () => ({ data: "", extension: "svg" as const }),
      renderPdf: async (_data: ArrayBuffer, page?: number) => {
        calls.push(page);
        return { data: `page-${page ?? 1}`, extension: "png" as const, page: Math.min(page ?? 1, 20) };
      }
    } satisfies VisualRenderer;
    return { app, mediaStore, calls, renderer };
  }

  it("renders the page requested by the wiki embed", async () => {
    const { app, mediaStore, calls, renderer } = harness();

    const result = await renderForAnki(
      app,
      mediaStore,
      "School/Rechnen.md",
      "![[Elementares Rechnen Mengen und Zahlen.pdf#page=16]]",
      renderer,
      { vaultName: "My Vault", sourceHref: sourceHref("My Vault", "card_1") }
    );

    expect(calls).toEqual([16]);
    expect(result.warnings).toEqual([]);
    expect(result.html).toContain("PDF page 16");
    expect(result.html).toContain("%23page%3D16");
  });

  it("renders the page requested by a Markdown image embed", async () => {
    const { app, mediaStore, calls, renderer } = harness();

    await renderForAnki(
      app,
      mediaStore,
      "School/Rechnen.md",
      "![](Elementares%20Rechnen%20Mengen%20und%20Zahlen.pdf#page=4)",
      renderer,
      { vaultName: "My Vault", sourceHref: sourceHref("My Vault", "card_1") }
    );

    expect(calls).toEqual([4]);
  });

  it("keeps the first page when the embed names none", async () => {
    const { app, mediaStore, calls, renderer } = harness();

    const result = await renderForAnki(
      app,
      mediaStore,
      "School/Rechnen.md",
      "![[Elementares Rechnen Mengen und Zahlen.pdf]]",
      renderer,
      { vaultName: "My Vault", sourceHref: sourceHref("My Vault", "card_1") }
    );

    expect(calls).toEqual([undefined]);
    expect(result.html).toContain(">PDF</a>");
    expect(result.html).not.toContain("%23page");
  });

  it("warns when the requested page does not exist", async () => {
    const { app, mediaStore, renderer } = harness();

    const result = await renderForAnki(
      app,
      mediaStore,
      "School/Rechnen.md",
      "![[Elementares Rechnen Mengen und Zahlen.pdf#page=99]]",
      renderer,
      { vaultName: "My Vault", sourceHref: sourceHref("My Vault", "card_1") }
    );

    expect(result.warnings).toEqual([
      "Elementares Rechnen Mengen und Zahlen.pdf has no page 99; page 20 was used instead."
    ]);
  });
});
