/**
 * Per-file entry point of the source viewer: detect the language of a
 * verified source file, then tokenize every line with the state carried from
 * the line before.
 */
import type { Token } from "./tokenize";
import { SOLIDITY_START, YUL_START, tokenizeSolidityLine } from "./tokenizeSolidity";
import { tokenizeVyperLine, type VyperLineState } from "./tokenizeVyper";

export type SourceLanguage = "solidity" | "yul" | "vyper";

const VYPER_PRAGMA_RE = /^\s*#\s*(?:pragma\s+version|@version)\b/m;
const VYPER_DECORATOR_RE = /^@(?:external|internal|view|pure|payable|nonpayable|deploy|nonreentrant)\b/m;
const VYPER_DEF_RE = /^def\s+\w+\s*\(/m;
const YUL_OBJECT_RE = /^\s*object\s+"[^"]*"\s*\{/m;
const SOLIDITY_MARK_RE = /^\s*(?:pragma\s+solidity|contract\s|library\s|interface\s|abstract\s+contract\s)/m;

/**
 * Detect the language from the file extension, then from the content. An
 * explorer can store a source under a name with no extension, so the content
 * check is the fallback. The default is Solidity.
 */
export function detectSourceLanguage(name: string, content: string): SourceLanguage {
  const lower = name.toLowerCase();
  if (/\.vyi?$/.test(lower)) return "vyper";
  if (lower.endsWith(".yul")) return "yul";
  if (lower.endsWith(".sol")) return "solidity";
  if (VYPER_PRAGMA_RE.test(content)) return "vyper";
  if (VYPER_DECORATOR_RE.test(content) && VYPER_DEF_RE.test(content)) return "vyper";
  if (YUL_OBJECT_RE.test(content) && !SOLIDITY_MARK_RE.test(content)) return "yul";
  return "solidity";
}

/** Tokenize every line of a file. The result has one token array per line. */
export function tokenizeSource(lines: readonly string[], language: SourceLanguage): Token[][] {
  if (language === "vyper") {
    let state: VyperLineState = "";
    return lines.map((line) => {
      const result = tokenizeVyperLine(line, state);
      state = result.state;
      return result.tokens;
    });
  }
  let state = language === "yul" ? YUL_START : SOLIDITY_START;
  return lines.map((line) => {
    const result = tokenizeSolidityLine(line, state);
    state = result.state;
    return result.tokens;
  });
}
