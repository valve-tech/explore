/**
 * Solidity and Yul tokenizer. Pure: one line and the state from the line
 * before go in, tokens and the next state come out.
 *
 * The viewer tokenizes line by line, so everything that outlives a line is in
 * `SolidityLineState`: an open block comment, the statement kind that makes
 * `from` and `global` keywords, and the depth of an `assembly { }` block.
 * A Solidity string cannot span lines, so a string carries no state.
 */
import { type Token, type TokenType, splitCommentToken } from "./tokenize";
import {
  matchOperator, scanNumber, scanString, scanWord, skipSpace, startsNumber,
} from "./lexShared";
import { type Prev, type StatementKind, classifySolidityWord, classifyYulWord, isIdentStart } from "./classifyWord";

export interface SolidityLineState {
  /** An open block comment: "plain" for `/*`, "doc" for `/**`. */
  comment: "none" | "plain" | "doc";
  /** The statement the line ends inside. It decides the contextual keywords. */
  statement: StatementKind;
  /** "pending" between the `assembly` keyword and its opening brace. */
  assembly: "none" | "pending" | "inside";
  /** Brace depth inside the assembly block. */
  depth: number;
}

export const SOLIDITY_START: SolidityLineState = {
  comment: "none", statement: "none", assembly: "none", depth: 0,
};

/** A file that is Yul from its first character never leaves Yul mode. */
export const YUL_START: SolidityLineState = {
  comment: "none", statement: "none", assembly: "inside", depth: Number.MAX_SAFE_INTEGER,
};

const OPERATORS = [
  ">>>=", ">>>", "<<=", ">>=", "**", "=>", "==", "!=", "<=", ">=", "&&", "||",
  "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
  "=", "!", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "~", "?", ":",
];
const YUL_OPERATORS = [":=", "->", ...OPERATORS];
const PUNCTUATION = "{}()[];,.";

function pushComment(tokens: Token[], value: string, doc: boolean): void {
  const token: Token = { type: "comment", value };
  if (doc) tokens.push(...splitCommentToken(token));
  else tokens.push(token);
}

/** Tokenize one line. Pass the returned `state` to the call for the next line. */
export function tokenizeSolidityLine(
  line: string,
  start: SolidityLineState = SOLIDITY_START,
): { tokens: Token[]; state: SolidityLineState } {
  const tokens: Token[] = [];
  const state = { ...start };
  let prev: Prev = { type: null, value: "" };
  let i = 0;

  const push = (type: TokenType, end: number) => {
    const token = { type, value: line.slice(i, end) };
    tokens.push(token);
    prev = token;
    i = end;
  };

  if (state.comment !== "none") {
    const endIdx = line.indexOf("*/");
    const doc = state.comment === "doc";
    if (endIdx === -1) {
      if (line.length > 0) pushComment(tokens, line, doc);
      return { tokens, state };
    }
    pushComment(tokens, line.slice(0, endIdx + 2), doc);
    i = endIdx + 2;
    state.comment = "none";
  }

  while (i < line.length) {
    const ch = line[i]!;

    if (/\s/.test(ch)) {
      const end = skipSpace(line, i);
      tokens.push({ type: "text", value: line.slice(i, end) });
      i = end;
      continue;
    }

    if (ch === "/" && line[i + 1] === "/") {
      // `///` is NatSpec. `////` is a plain comment.
      const doc = line[i + 2] === "/" && line[i + 3] !== "/";
      pushComment(tokens, line.slice(i), doc);
      return { tokens, state };
    }

    if (ch === "/" && line[i + 1] === "*") {
      // `/**` is NatSpec. `/**/` is an empty plain comment.
      const doc = line[i + 2] === "*" && line[i + 3] !== "/";
      const endIdx = line.indexOf("*/", i + 2);
      if (endIdx === -1) {
        pushComment(tokens, line.slice(i), doc);
        state.comment = doc ? "doc" : "plain";
        return { tokens, state };
      }
      pushComment(tokens, line.slice(i, endIdx + 2), doc);
      i = endIdx + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      push("string", scanString(line, i));
      continue;
    }

    if (startsNumber(line, i)) {
      // A pragma version (`0.8.20`) has two dots. It is one literal.
      const end = state.statement === "pragma" ? /[^\w.]|$/.exec(line.slice(i))!.index + i : scanNumber(line, i);
      push("number", end);
      continue;
    }

    if (isIdentStart(ch)) {
      const end = scanWord(line, i);
      const word = line.slice(i, end);
      const quote = line[end];
      // `unicode"..."` and `hex"..."` are one string literal.
      if ((word === "unicode" || word === "hex") && (quote === '"' || quote === "'")) {
        push("string", scanString(line, end));
        continue;
      }
      const next = line[skipSpace(line, end)];
      if (state.assembly === "inside") {
        push(classifyYulWord(word, prev, next), end);
        continue;
      }
      const type = classifySolidityWord(word, prev, next, state.statement);
      if (type === "keyword") {
        if (word === "pragma" || word === "import" || word === "using") state.statement = word;
        if (word === "assembly") state.assembly = "pending";
      }
      push(type, end);
      continue;
    }

    const op = matchOperator(line, i, state.assembly === "inside" ? YUL_OPERATORS : OPERATORS);
    if (op) {
      push("operator", i + op.length);
      continue;
    }

    if (PUNCTUATION.includes(ch)) {
      if (ch === ";") state.statement = "none";
      if (ch === "{") {
        // An import list (`import {A} from`) and a using list keep their statement.
        if (state.assembly === "pending") {
          state.assembly = "inside";
          state.depth = 1;
        } else if (state.assembly === "inside") {
          state.depth++;
        }
      }
      if (ch === "}" && state.assembly === "inside" && --state.depth === 0) {
        state.assembly = "none";
      }
      push("punctuation", i + 1);
      continue;
    }

    tokens.push({ type: "text", value: ch });
    i++;
  }

  return { tokens, state };
}

/**
 * Tokenize a single line with only block-comment state. Use
 * `tokenizeSolidityLine` when you walk a whole file.
 */
export function tokenizeLine(
  line: string,
  inBlockComment: boolean,
): { tokens: Token[]; inBlockComment: boolean } {
  const { tokens, state } = tokenizeSolidityLine(line, {
    ...SOLIDITY_START,
    comment: inBlockComment ? "plain" : "none",
  });
  return { tokens, inBlockComment: state.comment !== "none" };
}
