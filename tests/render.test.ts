import { describe, expect, it } from "vitest";
import { noteBelongsToCardKey, ownershipTag, type OwnedNoteInfo } from "../src/ownership";
import { fileHref, renderContext, sourceHref } from "../src/source-link";

describe("Anki source context", () => {
  it("makes only the note name the Obsidian link", () => {
    const href = sourceHref("My Vault", "card_123");
    const context = renderContext("School/Physics", "Motion", ["Mechanics"], href);

    expect(href).toBe("obsidian://anki-bridge?vault=My%20Vault&card=card_123");
    expect(context).toContain('<span class="folder">School/Physics</span> / ');
    expect(context).toContain(
      '<a class="note" href="obsidian://anki-bridge?vault=My%20Vault&amp;card=card_123">Motion</a>'
    );
    expect(context).not.toContain("In Obsidian öffnen");
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
