/**
 * Scanners that the Solidity and Vyper tokenizers share. Each scanner takes a
 * line and a start index, and returns the index one past the lexeme.
 */

const NUMBER_RE = /0[xX][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d[\d_]*)?/y;
const WORD_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;

/** True when a number literal starts at `i`: a digit, or a dot before a digit. */
export function startsNumber(line: string, i: number): boolean {
  const ch = line[i]!;
  if (ch >= "0" && ch <= "9") return true;
  return ch === "." && /[0-9]/.test(line[i + 1] ?? "");
}

/**
 * Scan a number literal: hex, decimal, fraction, exponent, and underscore
 * separators. A dot is part of the number only when a digit follows it, so
 * `arr[0].length` keeps its dot as punctuation.
 */
export function scanNumber(line: string, i: number): number {
  NUMBER_RE.lastIndex = i;
  const m = NUMBER_RE.exec(line);
  return m ? i + m[0].length : i + 1;
}

/** Scan an identifier or word. Returns `i` when no word starts there. */
export function scanWord(line: string, i: number): number {
  WORD_RE.lastIndex = i;
  const m = WORD_RE.exec(line);
  return m ? i + m[0].length : i;
}

/**
 * Scan a quoted string whose opening quote is at `i`. A backslash escapes
 * the next character. An unterminated string ends at the end of the line.
 */
export function scanString(line: string, i: number): number {
  const quote = line[i]!;
  let j = i + 1;
  while (j < line.length && line[j] !== quote) {
    if (line[j] === "\\") j++;
    j++;
  }
  return Math.min(j + 1, line.length);
}

/** Index of the first non-whitespace character at or after `i`. */
export function skipSpace(line: string, i: number): number {
  let j = i;
  while (j < line.length && /\s/.test(line[j]!)) j++;
  return j;
}

/** Longest operator from `ops` (sorted longest first) that starts at `i`. */
export function matchOperator(line: string, i: number, ops: readonly string[]): string | null {
  for (const op of ops) {
    if (line.startsWith(op, i)) return op;
  }
  return null;
}
