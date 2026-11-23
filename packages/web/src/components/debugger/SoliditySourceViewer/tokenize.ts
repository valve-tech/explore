/**
 * Token model for the source viewer, plus two pure post-passes: the NatSpec
 * tag splitter and the span splitter that segments a tokenized line at the
 * character range of the current opcode. No React, no DOM.
 *
 * The tokenizers live in sibling files: tokenizeSolidity.ts (Solidity and
 * Yul), tokenizeVyper.ts, and tokenizeSource.ts (the per-file entry point).
 *
 * The token vocabulary is small on purpose:
 *   keyword     reserved words and contextual keywords in keyword position
 *   type        elementary types only (uint256, bytes32, address, ...)
 *   builtin     names the compiler provides (msg, keccak256, mload, ...)
 *   function    a declared or called name: function, modifier, event, error
 *   identifier  every other user name, including contract and struct names
 *   number      number literals and their unit suffix (1 ether, 2 days)
 */

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

export type TokenType =
  | "keyword"
  | "type"
  | "builtin"
  | "function"
  | "number"
  | "string"
  | "comment"
  | "comment-tag"
  | "operator"
  | "punctuation"
  | "identifier"
  | "text";

export interface Token {
  type: TokenType;
  value: string;
}

/**
 * True for a token the user can click to go to its definition. A builtin has
 * no declaration in user source, so it is not navigable.
 */
export function isNavigableToken(token: Token): boolean {
  return token.type === "identifier" || token.type === "function";
}

export const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "#C678DD",
  type: "#E5C07B",
  builtin: "#7EC8E3",
  function: "#61AFEF",
  number: "#D19A66",
  string: "#98C379",
  comment: "#4B5263",
  "comment-tag": "#6B7394", // NatSpec tags — slightly brighter than comments
  operator: "#56B6C2",
  punctuation: "#636B7E",
  identifier: "#E06C75",
  text: "#ABB2BF",
};

// ---------------------------------------------------------------------------
// Highlight span — the exact character range the current opcode maps to.
// 1-indexed line+col, matching the backend's `offsetToLineCol`. Used by
// splitTokensBySpan to box the precise sub-expression executing.
// ---------------------------------------------------------------------------

export interface HighlightSpan {
  startLine: number;
  startCol: number; // 1-indexed; first highlighted char is at (startCol - 1)
  endLine: number;
  endCol: number; // 1-indexed exclusive end; last char is at (endCol - 2)
}

/** A token, possibly split so a sub-range can carry the span highlight. */
export interface RenderSegment {
  token: Token;
  highlighted: boolean;
}

// ---------------------------------------------------------------------------
// NatSpec post-pass
// ---------------------------------------------------------------------------

// `@custom:<name>` is one tag: the name is part of it.
const NATSPEC_TAG_RE =
  /@(custom(?::[\w-]+)?|dev|param|return|returns|notice|title|author|inheritdoc)\b/g;

/**
 * Split a comment token so embedded NatSpec tags (@dev, @param, …) render
 * with their own color. Non-comment tokens pass through unchanged. The
 * Solidity tokenizer calls this for doc comments only (triple-slash lines and double-star blocks);
 * a tag in a plain comment is not NatSpec.
 */
export function splitCommentToken(token: Token): Token[] {
  if (token.type !== "comment") return [token];
  const parts: Token[] = [];
  let lastIdx = 0;
  const val = token.value;
  NATSPEC_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = NATSPEC_TAG_RE.exec(val)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "comment", value: val.slice(lastIdx, match.index) });
    }
    parts.push({ type: "comment-tag", value: match[0] });
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx === 0) return [token];
  if (lastIdx < val.length) {
    parts.push({ type: "comment", value: val.slice(lastIdx) });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Span splitting
// ---------------------------------------------------------------------------

/**
 * Split a line's tokens into render segments, marking the characters that fall
 * inside the active span. A token straddling the span boundary is cut into
 * up to three pieces (before / inside / after) so the highlight lands on the
 * exact characters the compiler attributed to this opcode.
 */
export function splitTokensBySpan(
  tokens: Token[],
  lineNum: number,
  span: HighlightSpan | null,
): RenderSegment[] {
  if (!span || lineNum < span.startLine || lineNum > span.endLine) {
    return tokens.map((token) => ({ token, highlighted: false }));
  }

  // Per-line highlighted char range, in 0-based [start, end) coordinates.
  const lineStart = lineNum === span.startLine ? span.startCol - 1 : 0;
  const lineEnd = lineNum === span.endLine ? span.endCol - 1 : Infinity;

  const segments: RenderSegment[] = [];
  let col = 0;
  for (const token of tokens) {
    const tokStart = col;
    const tokEnd = col + token.value.length;
    col = tokEnd;

    const hiStart = Math.max(tokStart, lineStart);
    const hiEnd = Math.min(tokEnd, lineEnd);

    if (hiStart >= hiEnd) {
      segments.push({ token, highlighted: false });
      continue;
    }
    if (hiStart > tokStart) {
      segments.push({
        token: { type: token.type, value: token.value.slice(0, hiStart - tokStart) },
        highlighted: false,
      });
    }
    segments.push({
      token: { type: token.type, value: token.value.slice(hiStart - tokStart, hiEnd - tokStart) },
      highlighted: true,
    });
    if (hiEnd < tokEnd) {
      segments.push({
        token: { type: token.type, value: token.value.slice(hiEnd - tokStart) },
        highlighted: false,
      });
    }
  }
  return segments;
}
