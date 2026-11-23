/**
 * Vyper tokenizer. Small on purpose: it colours comments, strings, numbers,
 * decorators, keywords and elementary types correctly, and it does not apply
 * Solidity rules to a Python-like language. The only state that crosses a
 * line is an open triple-quoted docstring.
 */
import type { Token, TokenType } from "./tokenize";
import {
  matchOperator, scanNumber, scanString, scanWord, skipSpace, startsNumber,
} from "./lexShared";

/** The open docstring delimiter, or "" when no docstring is open. */
export type VyperLineState = "" | '"""' | "'''";

const KEYWORDS = new Set([
  "def", "event", "struct", "interface", "enum", "flag", "implements", "uses",
  "initializes", "exports", "import", "from", "as", "if", "elif", "else", "for",
  "in", "while", "return", "pass", "break", "continue", "raise", "assert", "log",
  "and", "or", "not", "is", "public", "constant", "immutable", "transient",
  "indexed", "payable", "nonpayable", "view", "pure", "extcall", "staticcall",
  "True", "False", "None", "self", "range", "unreachable",
]);

const BUILTINS = new Set([
  "msg", "block", "tx", "chain", "empty", "len", "convert", "concat", "slice",
  "keccak256", "sha256", "ecrecover", "raw_call", "raw_log", "raw_revert",
  "send", "selfdestruct", "create_minimal_proxy_to", "create_copy_of",
  "create_from_blueprint", "max", "min", "max_value", "min_value", "abs",
  "floor", "ceil", "unsafe_add", "unsafe_sub", "unsafe_mul", "unsafe_div",
  "isqrt", "sqrt", "pow_mod256", "uint256_addmod", "uint256_mulmod",
  "abi_encode", "abi_decode", "_abi_encode", "_abi_decode", "method_id",
  "as_wei_value", "blockhash", "print", "extract32", "shift", "epsilon",
]);

const TYPE_RE = /^(?:u?int\d{1,3}|bytes\d{1,2}|bool|address|decimal|String|Bytes|DynArray|HashMap)$/;

const OPERATORS = [
  "**=", "//=", "<<=", ">>=", "**", "//", "->", "==", "!=", "<=", ">=", "<<", ">>",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "~", ":",
];
const PUNCTUATION = "{}()[];,.";

function classify(word: string, prevValue: string, next: string | undefined): TokenType {
  if (prevValue === ".") return next === "(" ? "function" : "identifier";
  if (KEYWORDS.has(word)) return "keyword";
  if (TYPE_RE.test(word)) return "type";
  if (BUILTINS.has(word)) return "builtin";
  if (prevValue === "def" || next === "(") return "function";
  return "identifier";
}

/** Tokenize one line. Pass the returned `state` to the call for the next line. */
export function tokenizeVyperLine(
  line: string,
  start: VyperLineState = "",
): { tokens: Token[]; state: VyperLineState } {
  const tokens: Token[] = [];
  let state = start;
  let prevValue = "";
  let i = 0;

  const push = (type: TokenType, end: number) => {
    tokens.push({ type, value: line.slice(i, end) });
    prevValue = line.slice(i, end);
    i = end;
  };

  if (state !== "") {
    const endIdx = line.indexOf(state);
    if (endIdx === -1) {
      if (line.length > 0) tokens.push({ type: "string", value: line });
      return { tokens, state };
    }
    push("string", endIdx + 3);
    state = "";
  }

  while (i < line.length) {
    const ch = line[i]!;

    if (/\s/.test(ch)) {
      const end = skipSpace(line, i);
      tokens.push({ type: "text", value: line.slice(i, end) });
      i = end;
      continue;
    }

    if (ch === "#") {
      tokens.push({ type: "comment", value: line.slice(i) });
      return { tokens, state };
    }

    if (ch === '"' || ch === "'") {
      const triple = ch.repeat(3) as '"""' | "'''";
      if (line.startsWith(triple, i)) {
        const endIdx = line.indexOf(triple, i + 3);
        if (endIdx === -1) {
          tokens.push({ type: "string", value: line.slice(i) });
          return { tokens, state: triple };
        }
        push("string", endIdx + 3);
        continue;
      }
      push("string", scanString(line, i));
      continue;
    }

    if (startsNumber(line, i)) {
      push("number", scanNumber(line, i));
      continue;
    }

    // A decorator: `@external`, `@nonreentrant`.
    if (ch === "@" && scanWord(line, i + 1) > i + 1) {
      push("keyword", scanWord(line, i + 1));
      continue;
    }

    const wordEnd = scanWord(line, i);
    if (wordEnd > i) {
      const word = line.slice(i, wordEnd);
      push(classify(word, prevValue, line[skipSpace(line, wordEnd)]), wordEnd);
      continue;
    }

    const op = matchOperator(line, i, OPERATORS);
    if (op) {
      push("operator", i + op.length);
      continue;
    }

    if (PUNCTUATION.includes(ch)) {
      push("punctuation", i + 1);
      continue;
    }

    tokens.push({ type: "text", value: ch });
    i++;
  }

  return { tokens, state };
}
