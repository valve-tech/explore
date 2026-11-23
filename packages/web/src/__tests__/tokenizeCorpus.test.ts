import { describe, it, expect } from "vitest";
import type { Token } from "../components/debugger/SoliditySourceViewer/tokenize";
import {
  detectSourceLanguage,
  tokenizeSource,
  type SourceLanguage,
} from "../components/debugger/SoliditySourceViewer/tokenizeSource";

/**
 * Table-driven corpus for the source viewer tokenizers. Each row is a real
 * construct and the token class of every token that matters in it.
 *
 * A row lists [value, class] pairs. The test finds the pairs in order in the
 * token stream, so a row does not need to list whitespace or punctuation.
 * Every row also checks that the tokens join back to the source: a tokenizer
 * that drops or repeats a character moves the opcode highlight span.
 */

type Expect = [value: string, type: Token["type"]];
type Row = [name: string, source: string, expected: Expect[]];

function tokenize(source: string, language: SourceLanguage): Token[][] {
  return tokenizeSource(source.split("\n"), language);
}

function check(source: string, language: SourceLanguage, expected: Expect[]): void {
  const lines = tokenize(source, language);
  expect(lines.map((l) => l.map((t) => t.value).join("")).join("\n")).toBe(source);
  const flat = lines.flat();
  let from = 0;
  for (const [value, type] of expected) {
    const idx = flat.findIndex((t, i) => i >= from && t.value === value);
    expect(idx, "token " + JSON.stringify(value) + " not found in order").toBeGreaterThan(-1);
    expect(flat[idx]!.type, "class of " + JSON.stringify(value)).toBe(type);
    from = idx + 1;
  }
}

function run(language: SourceLanguage, rows: Row[]): void {
  it.each(rows)("%s", (_name, source, expected) => {
    check(source, language, expected);
  });
}

describe("Solidity corpus: keywords and contextual keywords", () => {
  run("solidity", [
    ["from is a keyword in an import", 'import {IERC20 as Token} from "./IERC20.sol";',
      [["import", "keyword"], ["IERC20", "identifier"], ["as", "keyword"], ["from", "keyword"], ['"./IERC20.sol"', "string"]]],
    ["from is an identifier as a parameter", "function transfer(address from, address to) external {}",
      [["transfer", "function"], ["address", "type"], ["from", "identifier"], ["to", "identifier"], ["external", "keyword"]]],
    ["from after a multi-line import list", "import {\n  A,\n  B\n} from \"x.sol\";\nuint from;",
      [["from", "keyword"], ['"x.sol"', "string"], ["uint", "type"], ["from", "identifier"]]],
    ["import star", 'import * as Lib from "lib.sol";', [["*", "operator"], ["as", "keyword"], ["Lib", "identifier"], ["from", "keyword"]]],
    ["error declares a custom error", "error InsufficientBalance(uint256 have, uint256 want);",
      [["error", "keyword"], ["InsufficientBalance", "function"], ["uint256", "type"], ["have", "identifier"]]],
    ["error is an identifier as a variable", "(bool ok, bytes memory error) = a.call(data); error.length;",
      [["bool", "type"], ["bytes", "type"], ["memory", "keyword"], ["error", "identifier"], ["call", "function"], ["error", "identifier"], ["length", "identifier"]]],
    ["revert with a custom error", "revert InsufficientBalance(1, 2);", [["revert", "keyword"], ["InsufficientBalance", "function"]]],
    ["revert with a string", 'revert("nope");', [["revert", "keyword"], ['"nope"', "string"]]],
    ["bare revert", "revert();", [["revert", "keyword"]]],
    ["global is a keyword after using", "using {add as +} for Fixed global;",
      [["using", "keyword"], ["add", "identifier"], ["as", "keyword"], ["for", "keyword"], ["Fixed", "identifier"], ["global", "keyword"]]],
    ["global is an identifier elsewhere", "uint256 global = 1;", [["global", "identifier"]]],
    ["using for", "using SafeMath for uint256;", [["using", "keyword"], ["SafeMath", "identifier"], ["for", "keyword"], ["uint256", "type"]]],
    ["unchecked block", "unchecked { ++i; }", [["unchecked", "keyword"], ["++", "operator"], ["i", "identifier"]]],
    ["emit an event", "emit Transfer(msg.sender, to, amount);",
      [["emit", "keyword"], ["Transfer", "function"], ["msg", "builtin"], ["sender", "identifier"]]],
    ["function modifiers", "function f() public view virtual override returns (uint256) {}",
      [["function", "keyword"], ["f", "function"], ["public", "keyword"], ["view", "keyword"], ["virtual", "keyword"], ["override", "keyword"], ["returns", "keyword"], ["uint256", "type"]]],
    ["immutable and constant", "uint256 public immutable cap; bytes32 internal constant SALT = 0x00;",
      [["immutable", "keyword"], ["cap", "identifier"], ["bytes32", "type"], ["constant", "keyword"], ["SALT", "identifier"], ["0x00", "number"]]],
    ["data locations", "function g(bytes calldata a, string memory b) internal { S storage s = x; }",
      [["calldata", "keyword"], ["memory", "keyword"], ["storage", "keyword"], ["s", "identifier"]]],
    ["transient storage", "uint256 transient lock; uint256 transient;", [["transient", "keyword"], ["lock", "identifier"], ["transient", "identifier"]]],
    ["type() expression", "type(uint256).max + type(IERC20).interfaceId",
      [["type", "keyword"], ["uint256", "type"], ["max", "identifier"], ["type", "keyword"], ["IERC20", "identifier"], ["interfaceId", "identifier"]]],
    ["user defined value type", "type Fixed is uint128;", [["type", "keyword"], ["Fixed", "identifier"], ["is", "keyword"], ["uint128", "type"]]],
    ["receive and fallback", "receive() external payable {} fallback(bytes calldata d) external {}",
      [["receive", "keyword"], ["payable", "keyword"], ["fallback", "keyword"], ["bytes", "type"]]],
    ["receive is an identifier as a name", "bool receive = true;", [["receive", "identifier"], ["true", "keyword"]]],
    ["a member is never a keyword", "x.error; y.from(1); z.type; w.uint8; v.msg",
      [["error", "identifier"], ["from", "function"], ["type", "identifier"], ["uint8", "identifier"], ["msg", "identifier"]]],
    ["try and catch", "try t.f() returns (bool ok) {} catch Error(string memory reason) {} catch (bytes memory low) {}",
      [["try", "keyword"], ["f", "function"], ["returns", "keyword"], ["catch", "keyword"], ["Error", "function"], ["string", "type"], ["catch", "keyword"]]],
    ["this and super", "address(this).balance; super.f();", [["address", "type"], ["this", "keyword"], ["balance", "identifier"], ["super", "keyword"], ["f", "function"]]],
    ["a keyword prefix does not make a keyword", "functionOK returnsX uint257 bytes33 bytes0 int7",
      [["functionOK", "identifier"], ["returnsX", "identifier"], ["uint257", "identifier"], ["bytes33", "identifier"], ["bytes0", "identifier"], ["int7", "identifier"]]],
  ]);
});

describe("Solidity corpus: elementary types", () => {
  const sized = [
    ...Array.from({ length: 32 }, (_, i) => "uint" + (i + 1) * 8),
    ...Array.from({ length: 32 }, (_, i) => "int" + (i + 1) * 8),
    ...Array.from({ length: 32 }, (_, i) => "bytes" + (i + 1)),
  ];
  it.each(sized)("%s is a type", (name) => {
    check(name + " x;", "solidity", [[name, "type"], ["x", "identifier"]]);
  });
  run("solidity", [
    ["plain types", "uint a; int b; bool c; string d; bytes e; address f;",
      [["uint", "type"], ["int", "type"], ["bool", "type"], ["string", "type"], ["bytes", "type"], ["address", "type"]]],
    ["address payable", "address payable to = payable(msg.sender);",
      [["address", "type"], ["payable", "keyword"], ["to", "identifier"], ["payable", "keyword"], ["msg", "builtin"]]],
    ["fixed point types", "fixed a; ufixed b; fixed128x18 c; ufixed256x80 d;",
      [["fixed", "type"], ["ufixed", "type"], ["fixed128x18", "type"], ["ufixed256x80", "type"]]],
    ["a cast", "uint256(x) + bytes4(sig)", [["uint256", "type"], ["bytes4", "type"]]],
  ]);
});

describe("Solidity corpus: literals", () => {
  run("solidity", [
    ["hex number", "x = 0xdead_BEEF;", [["0xdead_BEEF", "number"]]],
    ["underscores", "x = 1_000_000;", [["1_000_000", "number"]]],
    ["scientific", "x = 1e18 + 2.5e-3 + 1_0e1_0;", [["1e18", "number"], ["2.5e-3", "number"], ["1_0e1_0", "number"]]],
    ["fraction", "x = 0.5 ether + .5 ether;", [["0.5", "number"], ["ether", "number"], [".5", "number"], ["ether", "number"]]],
    ["ether units", "a = 1 wei + 2 gwei + 3 ether;", [["wei", "number"], ["gwei", "number"], ["ether", "number"]]],
    ["time units", "a = 1 seconds + 2 minutes + 3 hours + 4 days + 5 weeks;",
      [["seconds", "number"], ["minutes", "number"], ["hours", "number"], ["days", "number"], ["weeks", "number"]]],
    ["a unit name is an identifier without a number", "uint256 days = x; days + 1", [["days", "identifier"], ["days", "identifier"]]],
    ["a dot after an index is punctuation", "arr[0].value", [["0", "number"], [".", "punctuation"], ["value", "identifier"]]],
    ["string escapes", String.raw`s = "a \"quoted\" \\ \n \x41 \u0041"; t = 1;`,
      [[String.raw`"a \"quoted\" \\ \n \x41 \u0041"`, "string"], ["t", "identifier"], ["1", "number"]]],
    ["single quoted string", "s = 'it\\'s'; t", [["'it\\'s'", "string"], ["t", "identifier"]]],
    ["unicode string", 'unicode"Hello \u{1F600}" + x', [['unicode"Hello \u{1F600}"', "string"], ["x", "identifier"]]],
    ["hex string", 'bytes memory b = hex"00112233" hex"44_55";', [['hex"00112233"', "string"], ['hex"44_55"', "string"]]],
    ["hex and unicode are identifiers without a quote", "uint hex; uint unicode;", [["hex", "identifier"], ["unicode", "identifier"]]],
    ["a string that contains //", 's = "http://a.b"; uint x;', [['"http://a.b"', "string"], ["uint", "type"], ["x", "identifier"]]],
    ["a string that contains /*", 's = "/* not a comment"; uint x;', [['"/* not a comment"', "string"], ["uint", "type"]]],
    ["an unterminated string does not reach the next line", 's = "open\nuint x;', [['"open', "string"], ["uint", "type"], ["x", "identifier"]]],
    ["booleans", "bool a = true || false;", [["true", "keyword"], ["||", "operator"], ["false", "keyword"]]],
  ]);
});

describe("Solidity corpus: comments", () => {
  run("solidity", [
    ["line comment", "uint x; // trailing uint", [["uint", "type"], ["// trailing uint", "comment"]]],
    ["a comment that contains quotes", "x = 1; // don't \"stop\" here\nuint y;", [["// don't \"stop\" here", "comment"], ["uint", "type"]]],
    ["a block comment that contains quotes", "/* it's \"fine\" */ uint y;", [["/* it's \"fine\" */", "comment"], ["uint", "type"]]],
    ["a block comment across lines", "a /* one\ntwo uint\nthree */ uint b;",
      [["a", "identifier"], ["/* one", "comment"], ["two uint", "comment"], ["three */", "comment"], ["uint", "type"], ["b", "identifier"]]],
    ["a comment opener inside a line comment", "// see /* here\nuint x;", [["// see /* here", "comment"], ["uint", "type"]]],
    ["NatSpec line", "/// @notice Sends tokens\n/// @param to the receiver",
      [["/// ", "comment"], ["@notice", "comment-tag"], [" Sends tokens", "comment"], ["@param", "comment-tag"], [" to the receiver", "comment"]]],
    ["NatSpec block across lines", "/**\n * @dev Detail\n * @param amount how much\n * @return ok done\n */\nuint x;",
      [["/**", "comment"], ["@dev", "comment-tag"], ["@param", "comment-tag"], [" amount how much", "comment"], ["@return", "comment-tag"], [" */", "comment"], ["uint", "type"]]],
    ["NatSpec custom tag", "/// @custom:security-contact a@b.c", [["@custom:security-contact", "comment-tag"], [" a@b.c", "comment"]]],
    ["a tag in a plain line comment is not NatSpec", "// @param x no", [["// @param x no", "comment"]]],
    ["a tag in a plain block comment is not NatSpec", "/* @dev no\n @param no */", [["/* @dev no", "comment"], [" @param no */", "comment"]]],
    ["four slashes is a plain comment", "//// @dev no", [["//// @dev no", "comment"]]],
    ["an empty block comment", "/**/ uint x;", [["/**/", "comment"], ["uint", "type"]]],
  ]);
});

describe("Solidity corpus: declarations and statements", () => {
  run("solidity", [
    ["pragma solidity", "pragma solidity ^0.8.20;\nuint solidity;",
      [["pragma", "keyword"], ["solidity", "keyword"], ["^", "operator"], ["0.8.20", "number"], ["uint", "type"], ["solidity", "identifier"]]],
    ["pragma range", "pragma solidity >=0.7.0 <0.9.0;", [[">=", "operator"], ["0.7.0", "number"], ["<", "operator"], ["0.9.0", "number"]]],
    ["pragma abicoder", "pragma abicoder v2;", [["abicoder", "keyword"], ["v2", "keyword"]]],
    ["plain import", 'import "./A.sol";', [["import", "keyword"], ['"./A.sol"', "string"]]],
    ["contract header", "abstract contract Vault is Ownable, IVault {",
      [["abstract", "keyword"], ["contract", "keyword"], ["Vault", "identifier"], ["is", "keyword"], ["Ownable", "identifier"], ["IVault", "identifier"]]],
    ["interface and library", "interface IVault {} library Math {}",
      [["interface", "keyword"], ["IVault", "identifier"], ["library", "keyword"], ["Math", "identifier"]]],
    ["modifier declaration and use", "modifier onlyOwner() { require(msg.sender == owner, \"no\"); _; }\nfunction f() external onlyOwner {}",
      [["modifier", "keyword"], ["onlyOwner", "function"], ["require", "builtin"], ["==", "operator"], ["_", "identifier"], ["f", "function"], ["onlyOwner", "identifier"]]],
    ["modifier without parameters", "modifier nonReentrant {", [["modifier", "keyword"], ["nonReentrant", "function"]]],
    ["event declaration", "event Transfer(address indexed from, address indexed to, uint256 value) anonymous;",
      [["event", "keyword"], ["Transfer", "function"], ["indexed", "keyword"], ["from", "identifier"], ["anonymous", "keyword"]]],
    ["struct", "struct Position { uint128 size; address owner; }",
      [["struct", "keyword"], ["Position", "identifier"], ["uint128", "type"], ["size", "identifier"]]],
    ["enum", "enum State { Open, Closed }", [["enum", "keyword"], ["State", "identifier"], ["Open", "identifier"]]],
    ["mapping", "mapping(address => mapping(uint256 => bool)) public seen;",
      [["mapping", "keyword"], ["address", "type"], ["=>", "operator"], ["mapping", "keyword"], ["bool", "type"], ["public", "keyword"], ["seen", "identifier"]]],
    ["function declaration and call", "function mint(uint256 n) public { _mint(msg.sender, n); total += n; }",
      [["function", "keyword"], ["mint", "function"], ["n", "identifier"], ["_mint", "function"], ["total", "identifier"], ["+=", "operator"]]],
    ["member call and member read", "token.balanceOf(a).add(b); token.totalSupply; a.call{value: 1 ether}(\"\");",
      [["token", "identifier"], ["balanceOf", "function"], ["add", "function"], ["totalSupply", "identifier"], ["call", "identifier"], ["value", "identifier"], [":", "operator"], ["ether", "number"]]],
    ["new names a contract", "Token t = new Token(1);", [["Token", "identifier"], ["new", "keyword"], ["Token", "identifier"]]],
    ["constructor", "constructor(address o) Ownable(o) {}", [["constructor", "keyword"], ["address", "type"], ["Ownable", "function"]]],
    ["builtins", "bytes32 h = keccak256(abi.encode(block.timestamp, tx.origin)); assert(gasleft() > 0);",
      [["keccak256", "builtin"], ["abi", "builtin"], ["encode", "function"], ["block", "builtin"], ["timestamp", "identifier"], ["tx", "builtin"], ["assert", "builtin"], ["gasleft", "builtin"]]],
    ["operators", "a >>= 1; b = c ** 2; d = e >>> 1; f = g ? h : i; j <<= 2; k--;",
      [[">>=", "operator"], ["**", "operator"], [">>>", "operator"], ["?", "operator"], [":", "operator"], ["<<=", "operator"], ["--", "operator"]]],
    ["control flow", "for (uint i = 0; i < n; i++) { if (x) continue; else break; } while (y) { delete z; } do {} while (false); return x;",
      [["for", "keyword"], ["if", "keyword"], ["continue", "keyword"], ["else", "keyword"], ["break", "keyword"], ["while", "keyword"], ["delete", "keyword"], ["do", "keyword"], ["return", "keyword"]]],
  ]);
});

describe("Solidity corpus: inline assembly", () => {
  run("solidity", [
    ["one-line block", "assembly { let p := mload(0x40) mstore(p, 1) sstore(slot, p) }\nuint let;",
      [["assembly", "keyword"], ["let", "keyword"], ["p", "identifier"], [":=", "operator"], ["mload", "builtin"], ["0x40", "number"],
        ["mstore", "builtin"], ["sstore", "builtin"], ["slot", "identifier"], ["uint", "type"], ["let", "identifier"]]],
    ["a block across lines with nested braces", "assembly (\"memory-safe\") {\n  switch x\n  case 0 { revert(0, 0) }\n  default { return(0, 32) }\n}\nreturn address(0);",
      [["assembly", "keyword"], ['"memory-safe"', "string"], ["switch", "keyword"], ["case", "keyword"], ["revert", "builtin"],
        ["default", "keyword"], ["return", "builtin"], ["return", "keyword"], ["address", "type"]]],
    ["the opening brace on the next line", "assembly\n{\n  let x := add(1, 2)\n}\nuint add;",
      [["let", "keyword"], [":=", "operator"], ["add", "builtin"], ["add", "identifier"]]],
    ["a Yul function and loop", "assembly {\n  function f(a, b) -> r { r := add(a, b) leave }\n  for { let i := 0 } lt(i, 3) { i := add(i, 1) } { pop(f(i, 1)) }\n}",
      [["function", "keyword"], ["f", "function"], ["->", "operator"], ["r", "identifier"], ["leave", "keyword"], ["for", "keyword"], ["lt", "builtin"], ["pop", "builtin"], ["f", "function"]]],
    ["slot and offset members", "assembly { let s := data.slot let o := data.offset let a := address() }",
      [["data", "identifier"], ["slot", "identifier"], ["offset", "identifier"], ["address", "builtin"]]],
    ["a comment and a string with a brace", "assembly {\n  // }\n  let s := \"}\"\n  let x := caller()\n}\nuint caller;",
      [["// }", "comment"], ['"}"', "string"], ["caller", "builtin"], ["caller", "identifier"]]],
    ["mload is an identifier outside assembly", "uint mload = 1; mstore(x);", [["mload", "identifier"], ["mstore", "function"]]],
  ]);
});

describe("Yul corpus", () => {
  run("yul", [
    ["object file", "object \"Token\" {\n  code {\n    datacopy(0, dataoffset(\"runtime\"), datasize(\"runtime\"))\n    return(0, datasize(\"runtime\"))\n  }\n  data \"meta\" hex\"00\"\n}",
      [["object", "keyword"], ['"Token"', "string"], ["code", "keyword"], ["datacopy", "builtin"], ["dataoffset", "builtin"], ["return", "builtin"],
        ["data", "keyword"], ['"meta"', "string"], ['hex"00"', "string"]]],
    ["Solidity words are not keywords in Yul", "let memory := mload(0x40)\nlet contract := address()",
      [["let", "keyword"], ["memory", "identifier"], [":=", "operator"], ["contract", "identifier"], ["address", "builtin"]]],
  ]);
});

describe("Vyper corpus", () => {
  run("vyper", [
    ["pragma comment", "# pragma version ^0.4.0\nx: uint256", [["# pragma version ^0.4.0", "comment"], ["x", "identifier"], ["uint256", "type"]]],
    ["a decorated function", "@external\n@view\ndef balanceOf(owner: address) -> uint256:\n    return self.balances[owner]",
      [["@external", "keyword"], ["@view", "keyword"], ["def", "keyword"], ["balanceOf", "function"], ["address", "type"], ["->", "operator"],
        ["uint256", "type"], ["return", "keyword"], ["self", "keyword"], ["balances", "identifier"]]],
    ["a division is not a comment", "x: uint256 = a // b  # floor", [["//", "operator"], ["b", "identifier"], ["# floor", "comment"]]],
    ["storage and types", "balances: public(HashMap[address, uint256])\nname: String[32]",
      [["public", "keyword"], ["HashMap", "type"], ["address", "type"], ["String", "type"], ["32", "number"]]],
    ["Solidity keywords are identifiers", "contract: uint256\nfunction: bool", [["contract", "identifier"], ["function", "identifier"]]],
  ]);

  it("carries a docstring across lines", () => {
    const lines = tokenize('def f():\n    """\n    it\'s // text\n    """\n    x = 1', "vyper");
    expect(lines[1]!.map((t) => t.type)).toEqual(["text", "string"]);
    expect(lines[2]).toEqual([{ type: "string", value: "    it's // text" }]);
    expect(lines[3]![0]).toEqual({ type: "string", value: '    """' });
    expect(lines[4]!.some((t) => t.value === "x" && t.type === "identifier")).toBe(true);
  });
});

describe("detectSourceLanguage", () => {
  it.each<[string, string, SourceLanguage]>([
    ["contracts/Token.sol", "contract Token {}", "solidity"],
    ["contracts/Token.SOL", "", "solidity"],
    ["Vault.vy", "", "vyper"],
    ["IVault.vyi", "", "vyper"],
    ["Proxy.yul", "", "yul"],
    ["Vyper_contract", "# @version 0.3.10\n\nowner: address", "vyper"],
    ["Vyper_contract", "#pragma version ^0.4.0\n", "vyper"],
    ["Curve", "from vyper.interfaces import ERC20\n\n@external\ndef get() -> uint256:\n    return 1", "vyper"],
    ["Contract", 'object "C" {\n  code { }\n}', "yul"],
    ["Contract", "pragma solidity ^0.8.0;\ncontract C {}", "solidity"],
    ["Contract", "", "solidity"],
    // A Solidity file whose name has no extension, with a # in a comment.
    ["Flat", "// # pragma version\ncontract C {}", "solidity"],
  ])("%s -> %s", (name, content, language) => {
    expect(detectSourceLanguage(name, content)).toBe(language);
  });
});
