import { describe, it, expect } from "vitest";
import {
  splitCommentToken,
  type Token,
} from "../components/debugger/SoliditySourceViewer/tokenize";
import { tokenizeLine } from "../components/debugger/SoliditySourceViewer/tokenizeSolidity";

/**
 * Unit tests for the extracted Solidity tokenizer. The companion
 * splitTokensBySpan test already lives at splitTokensBySpan.test.ts —
 * that helper is also exported from tokenize.ts but its tests stay
 * separate for blame clarity.
 *
 * These tests target two concerns:
 *
 *   - `tokenizeLine` — line-by-line tokenization with block-comment
 *     state carried across lines via the (inBlockComment) input/output.
 *     The crucial cross-line concern is "I open a comment on this line,
 *     where does it actually end."
 *   - `splitCommentToken` — post-pass that splits a comment value at
 *     embedded NatSpec tags so they render with their own color.
 */

function values(tokens: Token[]): string[] {
  return tokens.map((t) => t.value);
}

function types(tokens: Token[]): string[] {
  return tokens.map((t) => t.type);
}

// ---------------------------------------------------------------------------
// tokenizeLine — basic token types
// ---------------------------------------------------------------------------

describe("tokenizeLine — basic tokens", () => {
  it("classifies a Solidity keyword as 'keyword'", () => {
    const { tokens } = tokenizeLine("function foo()", false);
    const fn = tokens.find((t) => t.value === "function");
    expect(fn?.type).toBe("keyword");
  });

  it("classifies a Solidity primitive type as 'type'", () => {
    const { tokens } = tokenizeLine("uint256 x", false);
    const u256 = tokens.find((t) => t.value === "uint256");
    expect(u256?.type).toBe("type");
  });

  it("classifies a non-keyword non-type word as 'identifier'", () => {
    const { tokens } = tokenizeLine("myVariable + 1", false);
    const id = tokens.find((t) => t.value === "myVariable");
    expect(id?.type).toBe("identifier");
  });

  it("classifies decimal numbers as 'number'", () => {
    const { tokens } = tokenizeLine("uint256 x = 12345;", false);
    const num = tokens.find((t) => t.value === "12345");
    expect(num?.type).toBe("number");
  });

  it("classifies hex literals as 'number' (0x-prefixed run of hex+underscore)", () => {
    const { tokens } = tokenizeLine("bytes32 h = 0xdead_beefCAFE;", false);
    const hex = tokens.find((t) => t.value === "0xdead_beefCAFE");
    expect(hex?.type).toBe("number");
  });

  it("classifies a double-quoted string as 'string'", () => {
    const { tokens } = tokenizeLine('require(true, "boom")', false);
    const s = tokens.find((t) => t.value === '"boom"');
    expect(s?.type).toBe("string");
  });

  it("classifies a single-quoted string as 'string'", () => {
    const { tokens } = tokenizeLine("require(true, 'oops')", false);
    const s = tokens.find((t) => t.value === "'oops'");
    expect(s?.type).toBe("string");
  });

  it("preserves backslash escapes inside a string", () => {
    const { tokens } = tokenizeLine('emit M("she said \\"hi\\"")', false);
    expect(values(tokens)).toContain('"she said \\"hi\\""');
  });

  it("classifies a single-line comment as 'comment'", () => {
    const { tokens } = tokenizeLine("uint x; // trailing", false);
    const c = tokens.find((t) => t.value === "// trailing");
    expect(c?.type).toBe("comment");
  });

  it("emits multi-char operators (==, !=, &&) as a single 'operator' token", () => {
    const { tokens } = tokenizeLine("a == b && c != d", false);
    const operators = tokens.filter((t) => t.type === "operator");
    const ops = operators.map((t) => t.value);
    expect(ops).toContain("==");
    expect(ops).toContain("&&");
    expect(ops).toContain("!=");
  });

  it("emits punctuation chars one at a time", () => {
    const { tokens } = tokenizeLine("foo(a, b);", false);
    const puncts = tokens.filter((t) => t.type === "punctuation");
    expect(puncts.map((t) => t.value)).toEqual(["(", ",", ")", ";"]);
  });

  it("classifies whitespace runs as 'text'", () => {
    const { tokens } = tokenizeLine("a   b", false);
    const ws = tokens.filter((t) => t.type === "text");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.some((t) => /\s+/.test(t.value))).toBe(true);
  });

  it("returns inBlockComment=false for a single-line input with no open block comment", () => {
    const { inBlockComment } = tokenizeLine("uint256 x;", false);
    expect(inBlockComment).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tokenizeLine — block comment state across lines
// ---------------------------------------------------------------------------

describe("tokenizeLine — block comment state", () => {
  it("returns inBlockComment=true when a /* is opened without a closing */", () => {
    const { tokens, inBlockComment } = tokenizeLine("uint x; /* note", false);
    expect(inBlockComment).toBe(true);
    const c = tokens.find((t) => t.value === "/* note");
    expect(c?.type).toBe("comment");
  });

  it("treats a line that's entirely inside a previous block comment as one comment token", () => {
    const { tokens, inBlockComment } = tokenizeLine("still inside the comment", true);
    expect(inBlockComment).toBe(true);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.type).toBe("comment");
  });

  it("closes a block comment mid-line and tokenizes what follows", () => {
    const { tokens, inBlockComment } = tokenizeLine("close */ uint y;", true);
    expect(inBlockComment).toBe(false);
    expect(values(tokens)).toContain("close */");
    const after = tokens.findIndex((t) => t.value === "uint");
    expect(after).toBeGreaterThan(-1);
    expect(tokens[after]?.type).toBe("type");
  });

  it("handles a /* */ that opens and closes on the same line", () => {
    const { tokens, inBlockComment } = tokenizeLine("uint /* inline */ x;", false);
    expect(inBlockComment).toBe(false);
    const c = tokens.find((t) => t.value === "/* inline */");
    expect(c?.type).toBe("comment");
  });
});

// ---------------------------------------------------------------------------
// tokenizeLine — edge cases
// ---------------------------------------------------------------------------

describe("tokenizeLine — edge cases", () => {
  it("emits an empty token array for an empty line", () => {
    const { tokens } = tokenizeLine("", false);
    expect(tokens).toEqual([]);
  });

  it("treats a $ as a valid identifier-start char", () => {
    const { tokens } = tokenizeLine("$x + _y", false);
    const idValues = tokens
      .filter((t) => t.type === "identifier")
      .map((t) => t.value);
    expect(idValues).toContain("$x");
    expect(idValues).toContain("_y");
  });

  it("falls through to 'text' for any unhandled char (e.g. backtick)", () => {
    const { tokens } = tokenizeLine("`", false);
    // The backtick isn't recognized as any specific token kind — falls through
    // to the catch-all `text` branch.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.value).toBe("`");
    expect(tokens[0]?.type).toBe("text");
  });

  it("doesn't mis-classify the function-keyword if part of a longer identifier", () => {
    const { tokens } = tokenizeLine("functionOK x", false);
    const id = tokens.find((t) => t.value === "functionOK");
    expect(id?.type).toBe("identifier");
  });
});

// ---------------------------------------------------------------------------
// splitCommentToken — NatSpec tag extraction
// ---------------------------------------------------------------------------

describe("splitCommentToken", () => {
  it("passes a non-comment token through unchanged", () => {
    const t: Token = { type: "identifier", value: "@param" };
    expect(splitCommentToken(t)).toEqual([t]);
  });

  it("passes a comment with no NatSpec tags through unchanged", () => {
    const t: Token = { type: "comment", value: "// nothing special here" };
    expect(splitCommentToken(t)).toEqual([t]);
  });

  it("splits a comment containing a NatSpec tag into 'comment' + 'comment-tag' + 'comment'", () => {
    const t: Token = { type: "comment", value: "/// @param x the value" };
    const result = splitCommentToken(t);
    expect(types(result)).toEqual(["comment", "comment-tag", "comment"]);
    expect(values(result)).toEqual(["/// ", "@param", " x the value"]);
  });

  it("recognizes every documented NatSpec tag", () => {
    for (const tag of [
      "@dev",
      "@param",
      "@return",
      "@returns",
      "@notice",
      "@title",
      "@author",
      "@inheritdoc",
      "@custom",
    ]) {
      const t: Token = { type: "comment", value: `// ${tag} body` };
      const result = splitCommentToken(t);
      expect(types(result)).toContain("comment-tag");
      const tagSeg = result.find((s) => s.type === "comment-tag");
      expect(tagSeg?.value).toBe(tag);
    }
  });

  it("handles a comment that BEGINS with a NatSpec tag (no leading 'comment' piece)", () => {
    const t: Token = { type: "comment", value: "@notice body" };
    const result = splitCommentToken(t);
    // The result starts with the tag — no empty leading comment slice.
    expect(types(result)).toEqual(["comment-tag", "comment"]);
  });

  it("handles a comment that ENDS at the NatSpec tag (no trailing 'comment' piece)", () => {
    const t: Token = { type: "comment", value: "// @dev" };
    const result = splitCommentToken(t);
    // No trailing slice past the tag.
    expect(types(result)).toEqual(["comment", "comment-tag"]);
    expect(result[result.length - 1]?.value).toBe("@dev");
  });

  it("extracts multiple NatSpec tags from a single comment", () => {
    const t: Token = {
      type: "comment",
      value: "/// @param x first @param y second",
    };
    const result = splitCommentToken(t);
    const tags = result.filter((s) => s.type === "comment-tag");
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.value)).toEqual(["@param", "@param"]);
  });

  it("does not match @something-not-in-the-tag-set as a tag", () => {
    const t: Token = { type: "comment", value: "// @bogus thing" };
    expect(splitCommentToken(t)).toEqual([t]);
  });
});
