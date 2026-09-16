import { describe, expect, it } from "vitest";
import { linkAnchor, renderLinkedText, type VaultLinkContext } from "../src/link-render";
import { renderContext, sourceHref, vaultLinkHref } from "../src/source-link";
import { describeEmbeds, parseWikiLink, replaceInternalLinks, stripLinkSyntax } from "../src/wikilink";

const context: VaultLinkContext = {
  vaultName: "My Vault",
  sourcePath: "Physik/Dissipation.md",
  resolve: (linkpath) => (linkpath === "Energie" || linkpath === "Physik/Dissipation.md"
    ? `Physik/${linkpath === "Energie" ? "Energie.md" : "Dissipation.md"}`
    : undefined)
};

describe("Obsidian link parsing", () => {
  it("splits target, subpath and alias", () => {
    expect(parseWikiLink("Energie")).toMatchObject({
      linkpath: "Energie",
      subpath: "",
      linktext: "Energie",
      display: "Energie"
    });
    expect(parseWikiLink("Widerstand|Widerstände")).toMatchObject({
      linkpath: "Widerstand",
      display: "Widerstände"
    });
    expect(parseWikiLink("Wärme#Konvektion")).toMatchObject({
      linktext: "Wärme#Konvektion",
      display: "Wärme > Konvektion"
    });
    expect(parseWikiLink("#Nur Überschrift")).toMatchObject({
      linkpath: "",
      subpath: "#Nur Überschrift",
      display: "Nur Überschrift"
    });
    expect(parseWikiLink("   ")).toBeUndefined();
  });

  it("skips embeds and inline code", () => {
    const replaced = replaceInternalLinks(
      "![[Bild.png]] and `[[Code]]` but [[Energie]]",
      (link) => `<${link.linkpath}>`
    );

    expect(replaced).toBe("![[Bild.png]] and `[[Code]]` but <Energie>");
  });

  it("treats relative Markdown links as vault links but leaves external ones alone", () => {
    const replaced = replaceInternalLinks(
      "[Energie](Physik/Energie.md) and [Docs](https://example.com) and ![x](a.png)",
      (link) => `<${link.linkpath}|${link.display}>`
    );

    expect(replaced).toBe(
      "<Physik/Energie.md|Energie> and [Docs](https://example.com) and ![x](a.png)"
    );
  });

  it("reduces embeds to a readable label", () => {
    expect(describeEmbeds("![[Pasted image 20260915213236.png]]")).toBe("Pasted image 20260915213236");
    expect(describeEmbeds("![[Skizze.png|Aufbau]]")).toBe("Aufbau");
    expect(describeEmbeds("[[Energie]]")).toBe("[[Energie]]");
  });

  it("keeps the display text when stripping link syntax", () => {
    expect(stripLinkSyntax("# [[Compton-Effekt]]")).toBe("# Compton-Effekt");
    expect(stripLinkSyntax("[[Widerstand|Widerstände]]")).toBe("Widerstände");
  });
});

describe("Obsidian links on cards", () => {
  it("routes through the plugin so links resolve relative to the source note", () => {
    const anchor = linkAnchor(parseWikiLink("Energie")!, context);

    expect(anchor).toBe(
      '<a class="oab-link" href="obsidian://anki-bridge?vault=My%20Vault&amp;link=Energie'
      + '&amp;source=Physik%2FDissipation.md">Energie</a>'
    );
    expect(vaultLinkHref("My Vault", "Energie", "Physik/Dissipation.md")).toBe(
      "obsidian://anki-bridge?vault=My%20Vault&link=Energie&source=Physik%2FDissipation.md"
    );
  });

  it("marks links whose target does not exist", () => {
    expect(linkAnchor(parseWikiLink("Fehlt")!, context)).toContain('class="oab-link is-unresolved"');
  });

  it("points a bare heading link at the note that owns the card", () => {
    const anchor = linkAnchor(parseWikiLink("#Herleitung")!, context);

    expect(anchor).toContain("link=%23Herleitung");
    expect(anchor).toContain("source=Physik%2FDissipation.md");
    expect(anchor).not.toContain("is-unresolved");
  });

  it("escapes surrounding text while linking", () => {
    const html = renderLinkedText("Energie & [[Wärme|Wärme <hot>]]", context);

    expect(html).toContain("Energie &amp; ");
    expect(html).toContain("Wärme &lt;hot&gt;</a>");
    expect(html).not.toContain("<hot>");
  });

  it("links context labels", () => {
    const html = renderContext(
      "Physik",
      "Dissipation",
      ["Umwandlung in [[Energie]]"],
      sourceHref("My Vault", "card_1"),
      [],
      (value) => renderLinkedText(value, context)
    );

    expect(html).toContain('<span class="context-label">Umwandlung in <a class="oab-link"');
    expect(html).toContain(">Energie</a></span>");
  });
});
