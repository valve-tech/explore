import type { ScopeLoc, StackScope } from "./stackScopes";

const WORD = /[\w$]/;

/** True when `inner` is a strict part of the source range of `outer`. */
export function isInside(inner: ScopeLoc, outer: ScopeLoc): boolean {
  if (inner.file !== outer.file) return false;
  const start = inner.line > outer.line || (inner.line === outer.line && inner.column >= outer.column);
  const end = inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endColumn <= outer.endColumn);
  const same = inner.line === outer.line && inner.column === outer.column && inner.endLine === outer.endLine && inner.endColumn === outer.endColumn;
  return start && end && !same;
}

/** Offset of (line, col) in the function snippet of `scope`, or -1. */
export function offsetInScope(scope: StackScope, file: string, line: number, col: number): number {
  const { loc } = scope;
  if (loc.file !== file || line < loc.line || line > loc.endLine) return -1;
  const snippet = loc.sourceSnippet;
  let offset = 0;
  for (let l = loc.line; l < line; l++) {
    const nl = snippet.indexOf("\n", offset);
    if (nl === -1) return -1;
    offset = nl + 1;
  }
  offset += line === loc.line ? col - (loc.column - 1) : col;
  return offset >= 0 && offset < snippet.length ? offset : -1;
}

/** True when the text at `offset` is exactly the plain identifier `word`. */
export function isPlainUse(text: string, offset: number, word: string): boolean {
  if (text.slice(offset, offset + word.length) !== word) return false;
  if (offset > 0 && WORD.test(text[offset - 1]!)) return false;
  const end = offset + word.length;
  if (end < text.length && WORD.test(text[end]!)) return false;
  let before = offset;
  while (before > 0 && /\s/.test(text[before - 1]!)) before--;
  let after = end;
  while (after < text.length && /\s/.test(text[after]!)) after++;
  const prev = text[before - 1];
  // A member name (`x.word`) or a named argument (`{word: 1}`) is not the variable.
  if (prev === ".") return false;
  if (text[after] === ":" && (prev === "{" || prev === ",")) return false;
  return true;
}
