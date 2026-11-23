import { describe, expect, it } from "vitest";
import { computeStackHeights } from "../stackHeights";
import type { ScopeLoc } from "../stackScopes";
import { stackValueAt } from "../stackValueAt";
import { positionOf } from "./loadTrace";

/**
 * A hand-made trace of one internal call, to test the rules for the pointer
 * position. The real traces test the stack rules.
 */
const FN = [
  "function pay(uint256 amount, address to, uint256 value) internal returns (uint256 left) {",
  "        // amount in a comment",
  '        string memory s = "amount";',
  "        wallet.amount = amount;",
  "        target.call{value: value}(abi.encode(amount));",
  "        Order memory o = Order({amount: amount, to: to});",
  "        left = flag ? value : amount;",
  "        assembly { let value := 1 }",
  "    }",
].join("\n");

const ADDR = "0x00000000000000000000000000000000000000aa";
// The function starts at line 10, column 5 (1-based), as the API reports it.
const fnLoc: ScopeLoc = { file: "Pay.sol", line: 10, column: 5, endLine: 18, endColumn: 6, sourceSnippet: FN, jumpType: "-" };
const call: ScopeLoc = { file: "Pay.sol", line: 30, column: 9, endLine: 30, endColumn: 30, sourceSnippet: "pay(7, to, 42)", jumpType: "i" };

const steps = [
  { pc: 0, op: "PUSH1", depth: 1 }, // return label 9
  { pc: 2, op: "PUSH1", depth: 1 }, // amount
  { pc: 4, op: "PUSH20", depth: 1 }, // to
  { pc: 25, op: "PUSH1", depth: 1 }, // value
  { pc: 27, op: "PUSH1", depth: 1 }, // jump target
  { pc: 29, op: "JUMP", depth: 1 },
  { pc: 100, op: "JUMPDEST", depth: 1 },
  { pc: 101, op: "PUSH1", depth: 1 },
  { pc: 103, op: "POP", depth: 1 },
  { pc: 104, op: "STOP", depth: 1 },
];
const stack = ["0x1e", "0x7", "0xa1077a294dde1b09bb078844df40758a5d0f9a27", "0x2a"];
const base = {
  steps,
  heights: computeStackHeights(steps),
  frames: [{ addr: ADDR, entry: 0, end: steps.length, depth: 1 }],
  currentStep: 7,
  traceSourceMaps: { [ADDR]: { 29: call, 100: fnLoc } },
  detail: { stack },
  compilerVersion: "0.6.12+commit.27d51765",
};

const at = (word: string, use = 0, extra = {}) =>
  stackValueAt({ ...base, word, ...positionOf(fnLoc, word, use), ...extra })?.value ?? null;

describe("stackValueAt: the pointer position", () => {
  it("reads a parameter at its declaration and at a plain use", () => {
    expect(positionOf(fnLoc, "amount", 0)).toEqual({ file: "Pay.sol", line: 10, col: 25 });
    expect(at("amount", 0)).toBe("7");
    expect(at("to", 0)).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
    // "wallet.amount = amount": the second word on the line is the variable.
    expect(positionOf(fnLoc, "amount", 4)).toEqual({ file: "Pay.sol", line: 13, col: 24 });
    expect(at("amount", 4)).toBe("7");
    expect(at("amount", 5)).toBe("7"); // abi.encode(amount)
    expect(at("amount", 7)).toBe("7"); // Order({amount: amount, ...}): the value
    expect(at("amount", 8)).toBe("7"); // flag ? value : amount
  });

  it("returns null for the same word in a comment or a string", () => {
    expect(at("amount", 1)).toBeNull();
    expect(at("amount", 2)).toBeNull();
  });

  it("returns null for a member name and for the name of a named argument", () => {
    expect(at("amount", 3)).toBeNull(); // wallet.amount
    expect(at("amount", 6)).toBeNull(); // Order({amount: ...})
    expect(at("to", 1)).toBeNull(); // Order({..., to: to}): the name
    expect(at("to", 2)).toBe("0xA1077a294dDE1B09bB078844df40758a5D0f9a27"); // the value
  });

  it("returns null for a parameter that an assembly variable shadows", () => {
    // 'value' is also declared by 'let value' in the assembly block.
    expect(at("value", 0)).toBeNull();
    expect(at("value", 2)).toBeNull();
  });

  it("returns null when the pointer is on another word, or outside the function", () => {
    const pos = positionOf(fnLoc, "amount", 0);
    expect(stackValueAt({ ...base, word: "amount", ...pos, col: pos.col + 1 })).toBeNull();
    expect(stackValueAt({ ...base, word: "amoun", ...pos })).toBeNull();
    expect(stackValueAt({ ...base, word: "amount", ...pos, line: 9 })).toBeNull();
    expect(stackValueAt({ ...base, word: "amount", ...pos, line: 19 })).toBeNull();
    expect(stackValueAt({ ...base, word: "amount", ...pos, file: "Other.sol" })).toBeNull();
    expect(stackValueAt({ ...base, word: "a-b", ...pos })).toBeNull();
  });

  it("reads the return variable only after the code generator pushes its slot", () => {
    const ret: ScopeLoc = { ...fnLoc, line: 10, column: 80, endLine: 10, endColumn: 92, sourceSnippet: "uint256 left" };
    expect(at("left", 0)).toBeNull(); // step 101 has no source location
    const maps = { [ADDR]: { 29: call, 100: fnLoc, 101: ret } };
    expect(at("left", 0, { traceSourceMaps: maps, currentStep: 8, detail: { stack: [...stack, "0x0"] } })).toBe("0");
    expect(at("left", 0, { traceSourceMaps: maps, currentStep: 7 })).toBeNull();
    expect(at("left", 0, { traceSourceMaps: maps, currentStep: 6, detail: { stack } })).toBeNull();
    // After the POP at step 8 the slot is gone.
    expect(at("left", 0, { traceSourceMaps: maps, currentStep: 9, detail: { stack } })).toBeNull();
    expect(at("amount", 0, { traceSourceMaps: maps, currentStep: 9, detail: { stack } })).toBe("7");
  });

  it("needs proof of the legacy code generator", () => {
    expect(at("amount", 0, { compilerVersion: undefined })).toBeNull();
    expect(at("amount", 0, { compilerVersion: "0.8.24" })).toBeNull();
    expect(at("amount", 0, { compilerVersion: "v0.7.4+commit.3f05b770" })).toBe("7");
    expect(at("amount", 0, { compilerVersion: "0.7.5" })).toBeNull();
    expect(at("amount", 0, { compilerVersion: "0.4.24", viaIR: true })).toBeNull();
  });

  it("returns null for a stack word that is not hex", () => {
    expect(at("amount", 0, { detail: { stack: [stack[0]!, "seven", stack[2]!, stack[3]!] } })).toBeNull();
    expect(at("amount", 0, { detail: { stack: ["label", ...stack.slice(1)] } })).toBeNull();
  });

  it("accepts stack words with no 0x prefix (older nodes)", () => {
    const bare = stack.map((w) => w.slice(2).padStart(64, "0"));
    expect(at("amount", 0, { detail: { stack: bare } })).toBe("7");
  });
});
