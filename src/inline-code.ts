export interface OffsetRange {
  from: number;
  to: number;
}

export function inlineCodeRanges(value: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "`" || isEscaped(value, index)) {
      index += 1;
      continue;
    }
    const openingFrom = index;
    while (value[index] === "`") {
      index += 1;
    }
    const delimiterLength = index - openingFrom;
    let closingFrom = index;
    while (closingFrom < value.length) {
      if (value[closingFrom] !== "`") {
        closingFrom += 1;
        continue;
      }
      let closingTo = closingFrom;
      while (value[closingTo] === "`") {
        closingTo += 1;
      }
      if (closingTo - closingFrom === delimiterLength) {
        ranges.push({ from: openingFrom, to: closingTo });
        index = closingTo;
        break;
      }
      closingFrom = closingTo;
    }
    if (closingFrom >= value.length) {
      index = openingFrom + delimiterLength;
    }
  }
  return ranges;
}

export function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function offsetInsideRanges(offset: number, ranges: OffsetRange[]): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}
