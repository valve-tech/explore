/**
 * Blank out comments and string contents, keeping every offset and newline.
 * The structural scanners can then count braces and parentheses safely.
 */
export function stripSource(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out.push(" "); i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e === -1 ? n : e + 2;
      for (; i < stop; i++) out.push(src[i] === "\n" ? "\n" : " ");
      continue;
    }
    if (c === '"' || c === "'") {
      out.push(c);
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < n) { out.push(" "); i++; }
        out.push(" ");
        i++;
      }
      if (i < n && src[i] === c) { out.push(c); i++; }
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Offsets of the first character of every line. */
export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** 1-based line that holds `offset`. */
export function lineAt(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Index of the bracket that closes the one at `open`, or `limit - 1`. */
export function matchClose(text: string, open: number, limit = text.length): number {
  const o = text[open]!;
  const c = o === "(" ? ")" : o === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < limit; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c && --depth === 0) return i;
  }
  return limit - 1;
}

/** Index of the bracket that opens the one at `close`, or -1. */
export function matchOpen(text: string, close: number): number {
  const c = text[close]!;
  const o = c === ")" ? "(" : c === "]" ? "[" : "{";
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === c) depth++;
    else if (text[i] === o && --depth === 0) return i;
  }
  return -1;
}

/** Number of top-level comma-separated items in `inner`; 0 when empty. */
export function countTopLevelItems(inner: string): number {
  if (inner.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}
