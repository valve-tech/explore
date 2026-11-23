import type { ParsedFile } from "./solIndex";
import { countTopLevelItems, matchClose, matchOpen } from "./stripSource";

export type Receiver =
  | { kind: "none" }
  | { kind: "super" }
  | { kind: "this" }
  /** `name.word` — a variable or a type name. */
  | { kind: "name"; name: string }
  /** `Type(expr).word` — an explicit cast. */
  | { kind: "cast"; typeName: string }
  | { kind: "unknown" };

export interface ClickContext {
  word: string;
  /** Offset of the word in the file. */
  start: number;
  receiver: Receiver;
  /** The word is followed by an argument list. */
  isCall: boolean;
  /** Argument count at the call site; null when not a call or named args. */
  argCount: number | null;
  /** The word just before, when there is no receiver (emit, revert, new…). */
  prevWord: string | null;
}

const WORD = /[\w$]/;

function wordEndingAt(text: string, end: number): { word: string; start: number } | null {
  let s = end;
  while (s > 0 && WORD.test(text[s - 1]!)) s--;
  return s === end ? null : { word: text.slice(s, end), start: s };
}

const skipBack = (text: string, i: number) => {
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  return i;
};
const skipFwd = (text: string, i: number) => {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
};

/** Describe the token under (line, col): 1-based line, 0-based column. */
export function clickContextAt(pf: ParsedFile, line: number, col: number): ClickContext | null {
  const lineStart = pf.lineStarts[line - 1];
  if (lineStart === undefined) return null;
  const text = pf.text;
  const at = lineStart + col;
  if (at >= text.length || !WORD.test(text[at]!)) return null;
  let start = at;
  while (start > 0 && WORD.test(text[start - 1]!)) start--;
  let end = at;
  while (end < text.length && WORD.test(text[end]!)) end++;
  const word = text.slice(start, end);
  if (/^[0-9]/.test(word)) return null;

  // Call site: optional `{value: …}` call options, then '('.
  let after = skipFwd(text, end);
  if (text[after] === "{") {
    const close = matchClose(text, after);
    const next = skipFwd(text, close + 1);
    if (text[next] === "(") after = next;
  }
  const isCall = text[after] === "(";
  let argCount: number | null = null;
  if (isCall) {
    const inner = text.slice(after + 1, matchClose(text, after));
    argCount = inner.trim().startsWith("{") ? null : countTopLevelItems(inner);
  }

  let receiver: Receiver = { kind: "none" };
  let prevWord: string | null = null;
  const before = skipBack(text, start);
  if (text[before - 1] === ".") {
    const r = skipBack(text, before - 1);
    const ch = text[r - 1];
    if (ch === ")") {
      const open = matchOpen(text, r - 1);
      const w = open > 0 ? wordEndingAt(text, skipBack(text, open)) : null;
      receiver = w ? { kind: "cast", typeName: w.word } : { kind: "unknown" };
    } else {
      const w = wordEndingAt(text, r);
      if (!w) receiver = { kind: "unknown" };
      else if (w.word === "super") receiver = { kind: "super" };
      else if (w.word === "this") receiver = { kind: "this" };
      else receiver = { kind: "name", name: w.word };
    }
  } else {
    prevWord = wordEndingAt(text, before)?.word ?? null;
  }
  return { word, start, receiver, isCall, argCount, prevWord };
}

/** The quoted path of an `import` line when (line, col) is on that path. */
export function importPathAt(pf: ParsedFile, line: number, col: number): string | null {
  const raw = pf.raw.split("\n")[line - 1];
  if (raw === undefined || !/^\s*import\b/.test(raw)) return null;
  const re = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (col >= m.index && col < m.index + m[0].length) return m[1]!;
  }
  return null;
}

/** Match an import path to a file of the set; the longest path suffix wins. */
export function resolveImportFile(path: string, fileNames: readonly string[]): string | null {
  const parts = path.split("/").filter((p) => p !== "." && p !== ".." && p !== "");
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join("/");
    const hit = fileNames.find((n) => n === suffix || n.endsWith("/" + suffix));
    if (hit) return hit;
  }
  return null;
}

const NOT_A_TYPE = new Set([
  "return", "returns", "emit", "revert", "new", "delete", "is", "import", "else", "function",
  "modifier", "event", "error", "struct", "enum", "contract", "interface", "library", "using",
  "for", "override", "virtual", "public", "private", "internal", "external", "view", "pure",
  "payable", "if", "while", "do", "try", "catch", "assembly", "unchecked", "throw", "var", "in",
]);

/**
 * Find the declaration of local `name` (a parameter, a return variable or a
 * local variable) in `[from, upTo)`. Returns its offset and its type name.
 */
export function findLocalDecl(
  text: string,
  from: number,
  upTo: number,
  name: string,
): { offset: number; typeName: string } | null {
  const esc = name.replace(/[$]/g, "\\$");
  const re = new RegExp(
    "([A-Za-z_$][\\w$.]*)((?:\\s*\\[[^\\]]*\\])*|\\s*\\([^;{}]*?\\))\\s+(?:(?:memory|storage|calldata|payable|indexed)\\s+)*(" + esc + ")\\b(?!\\s*\\()",
    "g",
  );
  const slice = text.slice(from, upTo);
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const typeName = m[1]!.split(".").pop()!;
    if (NOT_A_TYPE.has(typeName)) continue;
    if (m[2]!.trim().startsWith("(") && typeName !== "mapping") continue;
    const offset = from + m.index + m[0].length - name.length;
    return { offset, typeName };
  }
  return null;
}
