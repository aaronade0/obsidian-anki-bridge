import { escapeHtml } from "./source-link";

export interface ObsidianMathFragment {
  display: boolean;
  tex: string;
}

export function mathJaxForAnki({ display, tex }: ObsidianMathFragment): string {
  const delimiters = display ? ["\\[", "\\]"] : ["\\(", "\\)"];
  return escapeHtml(`${delimiters[0]}${tex}${delimiters[1]}`);
}

export function replaceObsidianMath(
  value: string,
  replacement: (fragment: ObsidianMathFragment) => string
): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] === "`") {
      const runLength = markerRunLength(value, index, "`");
      const closing = value.indexOf("`".repeat(runLength), index + runLength);
      if (closing >= 0) {
        const end = closing + runLength;
        result += value.slice(index, end);
        index = end;
        continue;
      }
    }

    if (value[index] !== "$" || isEscaped(value, index)) {
      result += value[index];
      index += 1;
      continue;
    }

    const display = value[index + 1] === "$";
    const delimiterLength = display ? 2 : 1;
    const contentStart = index + delimiterLength;
    if (!display && (contentStart >= value.length || /\s|\$/.test(value[contentStart] ?? ""))) {
      result += "$";
      index += 1;
      continue;
    }

    const closing = findClosingDelimiter(value, contentStart, display);
    if (closing < 0) {
      result += "$";
      index += 1;
      continue;
    }

    const tex = value.slice(contentStart, closing);
    if (!tex.trim()) {
      result += value.slice(index, closing + delimiterLength);
      index = closing + delimiterLength;
      continue;
    }
    result += replacement({ display, tex });
    index = closing + delimiterLength;
  }

  return result;
}

function findClosingDelimiter(value: string, from: number, display: boolean): number {
  for (let index = from; index < value.length; index += 1) {
    if (!display && value[index] === "\n") {
      return -1;
    }
    if (value[index] === "`") {
      const runLength = markerRunLength(value, index, "`");
      const closing = value.indexOf("`".repeat(runLength), index + runLength);
      if (closing >= 0) {
        index = closing + runLength - 1;
        continue;
      }
    }
    if (value[index] !== "$" || isEscaped(value, index)) {
      continue;
    }
    if (display) {
      if (value[index + 1] === "$") {
        return index;
      }
      continue;
    }
    if (value[index + 1] !== "$" && !/\s/.test(value[index - 1] ?? "")) {
      return index;
    }
  }
  return -1;
}

function markerRunLength(value: string, from: number, marker: string): number {
  let length = 0;
  while (value[from + length] === marker) {
    length += 1;
  }
  return length;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
