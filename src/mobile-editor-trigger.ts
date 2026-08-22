import type { EditorState, Transaction } from "@codemirror/state";

interface TypedEditorUpdate {
  docChanged: boolean;
  state: EditorState;
  transactions: readonly Transaction[];
}

export function findTypedDoubleChevronTrigger(
  update: TypedEditorUpdate
): { from: number; to: number } | undefined {
  if (!update.docChanged) {
    return undefined;
  }

  const selection = update.state.selection.main;
  if (!selection.empty || selection.head < 2) {
    return undefined;
  }

  const typedChevron = update.transactions.some((transaction) => {
    if (!transaction.isUserEvent("input.type")) {
      return false;
    }
    let insertedChevron = false;
    transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (inserted.toString().endsWith(">")) {
        insertedChevron = true;
      }
    });
    return insertedChevron;
  });
  if (!typedChevron) {
    return undefined;
  }

  const to = selection.head;
  const from = to - 2;
  return update.state.doc.sliceString(from, to) === ">>" ? { from, to } : undefined;
}
