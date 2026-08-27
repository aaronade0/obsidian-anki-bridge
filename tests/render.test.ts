import { describe, expect, it } from "vitest";
import { noteBelongsToCardKey, ownershipTag, type OwnedNoteInfo } from "../src/ownership";
import { fileHref, renderContext, sourceHref } from "../src/source-link";

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
