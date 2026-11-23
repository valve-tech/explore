/**
 * Word classification for the Solidity and Yul tokenizer. Pure: a word and
 * its neighbours go in, a token class comes out.
 */
import type { TokenType } from "./tokenize";
import {
  CALLABLE_DECLARATORS, NUMBER_UNITS, SOLIDITY_BUILTINS, SOLIDITY_KEYWORDS,
  YUL_BUILTINS, YUL_KEYWORDS, isElementaryType,
} from "./solidityWords";

const IDENT_START_RE = /[A-Za-z_$]/;

/** The statement kind that makes `from`, `global` and pragma words keywords. */
export type StatementKind = "none" | "pragma" | "import" | "using";

/** The last token that is not whitespace or a comment. */
export interface Prev {
  type: TokenType | null;
  value: string;
}

export function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && IDENT_START_RE.test(ch);
}

/** Classify a Solidity word. `next` is the first character after the word and its trailing space. */
export function classifySolidityWord(
  word: string,
  prev: Prev,
  next: string | undefined,
  statement: StatementKind,
): TokenType {
  const callable = next === "(" ? "function" : "identifier";
  // A member name is never a keyword: `x.length`, `abi.decode`, `e.error`.
  if (prev.value === ".") return callable;
  if (prev.type === "number" && NUMBER_UNITS.has(word)) return "number";
  if (statement === "pragma") return "keyword";
  if (SOLIDITY_KEYWORDS.has(word)) return "keyword";
  if (isElementaryType(word)) return "type";

  // Contextual keywords: an identifier unless the position makes it a keyword.
  switch (word) {
    case "from":
      if (statement === "import") return "keyword";
      break;
    case "global":
      if (statement === "using") return "keyword";
      break;
    case "error":
      if (isIdentStart(next)) return "keyword";
      break;
    case "revert":
      if (next === "(" || next === ";" || next === undefined || isIdentStart(next)) return "keyword";
      break;
    case "receive":
    case "fallback":
      if (next === "(" && prev.value !== "function") return "keyword";
      break;
    case "transient":
      if (isIdentStart(next) && (prev.type === "type" || prev.type === "identifier" || prev.value === "]")) {
        return "keyword";
      }
      break;
  }

  if (CALLABLE_DECLARATORS.has(prev.value) && prev.type === "keyword") return "function";
  if (SOLIDITY_BUILTINS.has(word)) return "builtin";
  // `new Token(...)` names a contract, not a function.
  if (prev.value === "new" && prev.type === "keyword") return "identifier";
  return callable;
}

export function classifyYulWord(word: string, prev: Prev, next: string | undefined): TokenType {
  // `x.slot`, `x.offset`, `x.length`: a member of a Solidity variable.
  if (prev.value === ".") return "identifier";
  if (YUL_KEYWORDS.has(word)) return "keyword";
  // Yul object syntax: `object "Name" {`, `code {`, `data "x" hex"..."`.
  if ((word === "object" || word === "data") && next === '"') return "keyword";
  if (word === "code" && next === "{") return "keyword";
  if (YUL_BUILTINS.has(word)) return "builtin";
  if (next === "(" || (prev.value === "function" && prev.type === "keyword")) return "function";
  return "identifier";
}
