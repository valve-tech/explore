import { describe, expect, it } from "vitest";
import { buildSolIndex } from "../../sourceNav/solIndex";
import { formatStackVar, formatValueWord, wordOf, type TypeResolver } from "../formatStackValue";
import { parseFunctionSignature, type StackVar } from "../functionSignature";
import { userTypeResolver } from "../userTypes";

const MAX = (1n << 256n) - 1n;

/** Parse one declaration, for example "uint8 x" or "string memory s". */
function decl(text: string, external = false): StackVar {
  return parseFunctionSignature(`function f(${text}) ${external ? "external" : "internal"} { }`)!.params[0]!;
}

/** Memory or call data from a hex string, as 32-byte words. */
const words = (hex: string) => hex.match(/.{1,64}/g)!.map((w) => w.padEnd(64, "0"));
const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");

describe("wordOf", () => {
  it("reads a stack word with or without the 0x prefix", () => {
    expect(wordOf("0x2a")).toBe(42n);
    expect(wordOf("2a")).toBe(42n);
    expect(wordOf("0x")).toBe(0n);
    expect(wordOf("0x" + "f".repeat(64))).toBe(MAX);
    expect(wordOf("0xzz")).toBeNull();
    expect(wordOf("0x" + "f".repeat(65))).toBeNull();
  });
});

describe("formatValueWord", () => {
  it("gives a checksummed address from the low 160 bits", () => {
    // The WPLS contract on PulseChain, with dirty high bits.
    const dirty = (0xdeadn << 160n) | 0xa1077a294dde1b09bb078844df40758a5d0f9a27n;
    expect(formatValueWord("address", dirty)).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
    expect(formatValueWord("address payable", 0n)).toBe("0x0000000000000000000000000000000000000000");
  });

  it("gives unsigned integers in decimal, masked to their size", () => {
    expect(formatValueWord("uint256", MAX)).toBe("115792089237316195423570985008687907853269984665640564039457584007913129639935");
    expect(formatValueWord("uint", 29763367701588581126167n)).toBe("29763367701588581126167");
    expect(formatValueWord("uint8", 0x1ffn)).toBe("255");
    expect(formatValueWord("uint112", (1n << 112n) + 5n)).toBe("5");
  });

  it("gives signed integers by two's complement", () => {
    expect(formatValueWord("int256", MAX)).toBe("-1");
    expect(formatValueWord("int", MAX - 41n)).toBe("-42");
    expect(formatValueWord("int64", MAX - 41n)).toBe("-42");
    expect(formatValueWord("int8", 0x80n)).toBe("-128");
    expect(formatValueWord("int8", 0x7fn)).toBe("127");
    // Dirty high bits above an int8 do not change the value.
    expect(formatValueWord("int8", 0xff05n)).toBe("5");
  });

  it("gives bool and fixed bytes", () => {
    expect(formatValueWord("bool", 0n)).toBe("false");
    expect(formatValueWord("bool", 1n)).toBe("true");
    expect(formatValueWord("bytes4", 0xdeadbeefn << 224n)).toBe("0xdeadbeef");
    expect(formatValueWord("bytes32", 1n)).toBe("0x" + word(1));
    expect(formatValueWord("byte", 0xabn << 248n)).toBe("0xab");
  });

  it("returns null for a type it does not know", () => {
    for (const t of ["uint7", "uint264", "int0", "bytes33", "bytes0", "string", "uint256[]", "Thing"]) {
      expect(formatValueWord(t, 1n), t).toBeNull();
    }
  });

  it("formats enums and contracts through the resolver", () => {
    const resolve: TypeResolver = (name) =>
      name === "Mode" ? { kind: "enum", members: ["Off", "On", "Auto"] } : name === "IERC20" ? { kind: "contract" } : name === "Pair" ? { kind: "struct" } : null;
    expect(formatValueWord("Mode", 2n, resolve)).toBe("Auto (2)");
    expect(formatValueWord("Mode", 7n, resolve)).toBe("7");
    expect(formatValueWord("IERC20", 0xa1077a294dde1b09bb078844df40758a5d0f9a27n, resolve)).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
    expect(formatValueWord("Pair", 2n, resolve)).toBeNull();
  });
});

describe("formatStackVar", () => {
  it("shows the raw word, with a note, for a user type it cannot resolve", () => {
    expect(formatStackVar(decl("Mode mode"), [2n], {})).toEqual({
      value: "0x" + word(2),
      source: "stack",
      note: "raw stack word: type Mode not decoded",
    });
  });

  it("decodes a string and bytes from memory", () => {
    // Length 8 at 0x80, then "hover me".
    const memory = words(word(0).repeat(4) + word(8) + "686f766572206d65");
    expect(formatStackVar(decl("string memory s"), [0x80n], { memory })).toEqual({ value: '"hover me"', source: "memory" });
    expect(formatStackVar(decl("bytes memory b"), [0x80n], { memory })).toEqual({ value: "0x686f766572206d65", source: "memory" });
  });

  it("accepts memory words with the 0x prefix", () => {
    const memory = words(word(2) + "7832").map((w) => "0x" + w);
    expect(formatStackVar(decl("bytes memory b"), [0n], { memory })?.value).toBe("0x7832");
  });

  it("shows bytes as hex when a string is not valid UTF-8", () => {
    const memory = words(word(2) + "ff00");
    expect(formatStackVar(decl("string memory s"), [0n], { memory })).toEqual({
      value: "0xff00",
      source: "memory",
      note: "not valid UTF-8: shown as hex",
    });
  });

  it("shows the pointer, with a note, when the memory is not there or too short", () => {
    const pointer = { value: "memory @0x80", source: "stack", note: "memory pointer: contents not decoded" };
    expect(formatStackVar(decl("string memory s"), [0x80n], {})).toEqual(pointer);
    expect(formatStackVar(decl("string memory s"), [0x80n], { memory: words(word(0)) })).toEqual(pointer);
    // The length word says 64 bytes, but the memory ends before that.
    expect(formatStackVar(decl("string memory s"), [0x80n], { memory: words(word(0).repeat(4) + word(64) + word(1)) })).toEqual(pointer);
    // A struct has no decoder.
    expect(formatStackVar(decl("Pair memory p"), [0x80n], { memory: words(word(0).repeat(8)) })).toEqual(pointer);
  });

  it("decodes arrays of value types from memory", () => {
    const memory = words(word(3) + word(10) + word(20) + word(30));
    expect(formatStackVar(decl("uint256[] memory ys"), [0n], { memory })).toEqual({ value: "[10, 20, 30]", source: "memory" });
    expect(formatStackVar(decl("uint256[2] memory ys"), [0x20n], { memory })).toEqual({ value: "[10, 20]", source: "memory" });
    expect(formatStackVar(decl("bool[] memory flags"), [0n], { memory: words(word(2) + word(1) + word(0)) })?.value).toBe("[true, false]");
    // An array of arrays holds pointers. It has no decoder.
    expect(formatStackVar(decl("uint256[][] memory m"), [0n], { memory })?.value).toBe("memory @0x0");
  });

  it("limits long values and says so", () => {
    const long = words(word(40) + Array.from({ length: 40 }, (_, i) => word(i)).join(""));
    const arr = formatStackVar(decl("uint256[] memory ys"), [0n], { memory: long })!;
    expect(arr.value.endsWith(", 31, …]")).toBe(true);
    expect(arr.note).toBe("shows the first 32 of 40 items");
    const big = formatStackVar(decl("bytes memory b"), [0n], { memory: words(word(2000) + "ab".repeat(2000)) })!;
    expect(big.value).toBe("0x" + "ab".repeat(1024) + "…");
    expect(big.note).toBe("shows the first 1024 of 2000 bytes");
  });

  it("decodes a dynamic calldata value from its two slots: offset, then length", () => {
    // selector, then "hi" at offset 4.
    const calldata = "0x12345678" + "6869" + "00".repeat(30);
    const s = decl("string calldata s", true);
    expect(s.slots).toBe(2);
    expect(formatStackVar(s, [4n, 2n], { calldata })).toEqual({ value: '"hi"', source: "calldata" });
    expect(formatStackVar(s, [4n, 2n], {})).toEqual({
      value: "calldata @0x4 (length 2)",
      source: "stack",
      note: "calldata reference: contents not decoded",
    });
    // The length points past the end of the call data.
    expect(formatStackVar(s, [4n, 200n], { calldata })?.value).toBe("calldata @0x4 (length 200)");
    const xs = decl("uint256[] calldata xs", true);
    expect(formatStackVar(xs, [4n, 2n], { calldata: "0x12345678" + word(10) + word(20) })).toEqual({ value: "[10, 20]", source: "calldata" });
  });

  it("shows a storage reference as a slot, with a note", () => {
    const note = "storage reference: contents not decoded";
    expect(formatStackVar(decl("uint256[] storage list"), [3n], {})).toEqual({ value: "storage slot 0x3", source: "stack", note });
    expect(formatStackVar(decl("mapping(address => uint256) storage book"), [1n], {})).toEqual({ value: "storage slot 0x1", source: "stack", note });
  });

  it("returns null when the word count does not agree with the slot count", () => {
    expect(formatStackVar(decl("uint256 a"), [], {})).toBeNull();
    expect(formatStackVar(decl("uint256 a"), [1n, 2n], {})).toBeNull();
    expect(formatStackVar(decl("string calldata s", true), [4n], {})).toBeNull();
  });
});

describe("userTypeResolver", () => {
  const index = buildSolIndex([
    {
      name: "A.sol",
      content: [
        "interface IERC20 { function totalSupply() external view returns (uint256); }",
        "library Math { function max(uint a, uint b) internal pure returns (uint) { return a > b ? a : b; } }",
        "contract A {",
        "  enum Mode { Off, On, /* soon */ Auto }",
        "  struct Pair { uint128 a; uint128 b; }",
        "  enum Twice { X }",
        "}",
        "contract B { enum Twice { Y, Z } }",
      ].join("\n"),
    },
  ]);
  const resolve = userTypeResolver(index);

  it("resolves enums with their members, contracts and structs", () => {
    expect(resolve("Mode")).toEqual({ kind: "enum", members: ["Off", "On", "Auto"] });
    expect(resolve("A.Mode")).toEqual({ kind: "enum", members: ["Off", "On", "Auto"] });
    expect(resolve("IERC20")).toEqual({ kind: "contract" });
    expect(resolve("A")).toEqual({ kind: "contract" });
    expect(resolve("Pair")).toEqual({ kind: "struct" });
  });

  it("returns null for a library, an unknown name, and a name with two meanings", () => {
    expect(resolve("Math")).toBeNull();
    expect(resolve("Nothing")).toBeNull();
    expect(resolve("Twice")).toBeNull();
  });
});
