import { describe, expect, it } from "vitest";
import { deriveDeckName, sourceContext } from "../src/deck";

describe("deck derivation", () => {
  it("copies vault folders and note name into nested Anki decks", () => {
    expect(deriveDeckName("Obsidian Flashcards", "Study Vault", "School/Physics/Kinematics.md")).toBe(
      "Obsidian Flashcards::Study Vault::School::Physics::Kinematics"
    );
  });

  it("sanitizes Anki separators inside individual path segments", () => {
    expect(deriveDeckName("Root", "Vault", "A::B/Note.md")).toBe("Root::Vault::A∷B::Note");
  });

  it("returns a breadcrumb context", () => {
    expect(sourceContext("Schule/Physik/Kinematik.md", ["Herleitung", "Schritt 1"])).toEqual({
      folderPath: "Schule/Physik",
      noteName: "Kinematik",
      headingPath: ["Herleitung", "Schritt 1"],
      listContext: []
    });
  });

  it("retains the list ancestry alongside heading context", () => {
    expect(sourceContext("Physics/Mechanics.md", ["Forces"], ["Newtonian mechanics", "Examples"]))
      .toMatchObject({
        headingPath: ["Forces"],
        listContext: ["Newtonian mechanics", "Examples"]
      });
  });

  it("does not repeat a top-level heading equal to the note name", () => {
    expect(sourceContext("Physics/Kinematics.md", ["Kinematics", "Derivation"]).headingPath).toEqual(["Derivation"]);
  });
});
