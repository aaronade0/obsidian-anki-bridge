import { EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { findTypedDoubleChevronTrigger } from "../src/mobile-editor-trigger";

function typedUpdate(before: string, inserted: string, userEvent = "input.type") {
  const state = EditorState.create({ doc: before });
  const transaction = state.update({
    changes: { from: before.length, insert: inserted },
    selection: { anchor: before.length + inserted.length },
    annotations: Transaction.userEvent.of(userEvent)
  });
  return {
    docChanged: true,
    state: transaction.state,
    transactions: [transaction]
  };
}

describe("mobile double-chevron trigger", () => {
  it("recognizes the second typed chevron immediately after the first", () => {
    expect(findTypedDoubleChevronTrigger(typedUpdate("Question >", ">"))).toEqual({
      from: "Question ".length,
      to: "Question >>".length
    });
  });

  it("does nothing for a single chevron", () => {
    expect(findTypedDoubleChevronTrigger(typedUpdate("Question ", ">"))).toBeUndefined();
  });

  it("does not react to pasted or synchronized double chevrons", () => {
    expect(findTypedDoubleChevronTrigger(typedUpdate("Question ", ">>", "input.paste"))).toBeUndefined();

    const state = EditorState.create({ doc: "Question >>" });
    expect(findTypedDoubleChevronTrigger({
      docChanged: false,
      state,
      transactions: []
    })).toBeUndefined();
  });

  it("supports keyboards that insert both chevrons in one typing transaction", () => {
    expect(findTypedDoubleChevronTrigger(typedUpdate("Question ", ">>"))).toEqual({
      from: "Question ".length,
      to: "Question >>".length
    });
  });

  it("supports mobile keyboards that report composed typing", () => {
    expect(findTypedDoubleChevronTrigger(typedUpdate("Question >", ">", "input.type.compose"))).toEqual({
      from: "Question ".length,
      to: "Question >>".length
    });
  });
});
