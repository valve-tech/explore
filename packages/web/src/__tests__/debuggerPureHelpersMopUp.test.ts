import { describe, it, expect } from "vitest";
import { buildFunctionIndex, classifyFn } from "../components/debugger/StepDebugger/functionIndex";
import { resolveTreeKey, flattenVisible } from "../components/debugger/StepDebugger/treeKeyboard";
import { findDefinitionLine } from "../components/debugger/StepDebugger/findDefinitionLine";
import { findFunctionLine } from "../components/debugger/StepDebugger/findFunctionLine";
import {
  extractSelector,
  bestMatchSignature,
} from "../components/debugger/StepDebugger/callTreeHelpers";
import { mapFramesToSteps } from "../components/debugger/StepDebugger/callTreeModel";
import { describeOperands } from "../components/debugger/StepDebugger/opcodeOperands";
import {
  buildExecutionTree,
  type ExecNode,
} from "../components/debugger/StepDebugger/executionScopes";
import type { OpcodeStep, CallFrame } from "../api/debugger";
import type { SourceLocation } from "../api/source";

// ---------------------------------------------------------------------------
// functionIndex.ts — uncovered: modifier (50), constructor (51), fallback (53),
// and classifyFn's "no enclosing fn" return null (89).
// ---------------------------------------------------------------------------
describe("functionIndex mop-up", () => {
  // A contract that declares a modifier, a constructor, and a fallback so each
  // indexFile branch fires.
  const SRC = [
    "contract C {", // 1
    "  modifier onlyOwner() { _; }", // 2
    "  constructor() {}", // 3
    "  fallback() external payable {}", // 4
    "}", // 5
  ].join("\n");
  const index = buildFunctionIndex([{ name: "C.sol", content: SRC }]);

  it("indexes a modifier declaration", () => {
    expect(classifyFn(index, "C.sol", 2)).toEqual({ name: "onlyOwner", isLibrary: false });
  });

  it("indexes a constructor declaration", () => {
    expect(classifyFn(index, "C.sol", 3)).toEqual({ name: "constructor", isLibrary: false });
  });

  it("indexes a fallback declaration", () => {
    expect(classifyFn(index, "C.sol", 4)).toEqual({ name: "fallback", isLibrary: false });
  });

  it("returns null when no function encloses the line (line above the first fn)", () => {
    // Line 1 (the contract header) sits before any callable declaration, so
    // enclosing() finds nothing → classifyFn returns null (line 89).
    expect(classifyFn(index, "C.sol", 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// treeKeyboard.ts — uncovered: ArrowRight with no selection (65), ArrowRight on
// an expanded last row (68 → null), ArrowLeft with no selection (70), ArrowLeft
// on a root leaf with no parent (73 → null).
// ---------------------------------------------------------------------------
describe("treeKeyboard mop-up", () => {
  const leaf: ExecNode = { kind: "fn", name: "a", line: 1, startStep: 1, entryStep: 1, endStep: 2, children: [] };
  const root: ExecNode = {
    kind: "call",
    frame: { to: "0xabc", input: "0xdeadbeef" } as never,
    startStep: 0,
    children: [leaf],
  };
  const rows = flattenVisible(root, {});

  it("ArrowRight with no current selection focuses the first row", () => {
    expect(resolveTreeKey("ArrowRight", rows, null)).toEqual({ type: "focus", key: rows[0]!.key });
  });

  it("ArrowLeft with no current selection focuses the first row", () => {
    expect(resolveTreeKey("ArrowLeft", rows, null)).toEqual({ type: "focus", key: rows[0]!.key });
  });

  it("ArrowRight on an expanded row that is the last visible row returns null", () => {
    // A single-node tree (a leaf with no children): the only row is the root.
    // It's not expandable, so ArrowRight falls through to the final `return null`.
    const lonely: ExecNode = { kind: "fn", name: "x", line: 1, startStep: 0, entryStep: 0, endStep: 1, children: [] };
    const lonelyRows = flattenVisible(lonely, {});
    expect(resolveTreeKey("ArrowRight", lonelyRows, lonelyRows[0]!.key)).toBeNull();
  });

  it("ArrowLeft on a top-level leaf with no parent returns null", () => {
    const lonely: ExecNode = { kind: "fn", name: "x", line: 1, startStep: 0, entryStep: 0, endStep: 1, children: [] };
    const lonelyRows = flattenVisible(lonely, {});
    expect(resolveTreeKey("ArrowLeft", lonelyRows, lonelyRows[0]!.key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findDefinitionLine.ts — uncovered 134-135: a declaration found while NOT
// inside any contract/interface scope (the `inContractHit === null &&
// inInterfaceHit === null` fall-through bucket). A top-level free function
// (Solidity 0.7+ allows file-level functions) lands there.
// ---------------------------------------------------------------------------
describe("findDefinitionLine mop-up", () => {
  it("resolves a top-level (file-scope) free function outside any contract", () => {
    const SRC = [
      "// SPDX", // 1
      "pragma solidity ^0.8.0;", // 2
      "", // 3
      "function freeHelper(uint256 x) pure returns (uint256) {", // 4
      "  return x + 1;", // 5
      "}", // 6
    ].join("\n");
    const hit = findDefinitionLine([{ name: "Free.sol", content: SRC }], "freeHelper");
    expect(hit).toEqual({ file: "Free.sol", line: 4, kind: "function" });
  });
});

// ---------------------------------------------------------------------------
// findFunctionLine.ts — uncovered 69-70: a function declaration matched while
// not inside a contract or interface (the contractMatch===null &&
// interfaceMatch===null fall-through).
// ---------------------------------------------------------------------------
describe("findFunctionLine mop-up", () => {
  it("matches a top-level free function outside contract/interface scope", () => {
    const SRC = [
      "pragma solidity ^0.8.0;", // 1
      "", // 2
      "function topLevel() pure returns (bool) {", // 3
      "  return true;", // 4
      "}", // 5
    ].join("\n");
    expect(findFunctionLine([{ name: "Free.sol", content: SRC }], "topLevel")).toEqual({
      file: "Free.sol",
      line: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// callTreeHelpers.ts — uncovered: extractSelector catch (27), bestMatchSignature
// zero-param return (78), zero-param continue path, and the length-fallback
// sort (90).
// ---------------------------------------------------------------------------
function opStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "CALL", gas: 0, gasCost: 0, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

describe("callTreeHelpers mop-up", () => {
  it("extractSelector returns undefined when the stack value isn't valid hex (catch path)", () => {
    // A non-hex stack entry forces BigInt() to throw → the catch returns undefined.
    // Cast: the OpcodeStep type narrows these to `0x${string}`, but we're
    // deliberately feeding malformed data to drive the defensive catch.
    const s = opStep({
      op: "CALL",
      stack: ["0x1", "0x2", "0x3", "not-hex"] as unknown as OpcodeStep["stack"],
      memory: ["00"] as unknown as OpcodeStep["memory"],
    });
    expect(extractSelector(s)).toBeUndefined();
  });

  it("bestMatchSignature returns a zero-param candidate when calldata is just the selector", () => {
    // Two candidates; calldata is selector-only (4 bytes → paramBytes 0). The
    // empty-params candidate matches the paramBytes===0 branch.
    const out = bestMatchSignature(
      [
        { textSignature: "foo(uint256)", hexSignature: "0x" },
        { textSignature: "ping()", hexSignature: "0x" },
      ] as never,
      "0xa9059cbb",
    );
    expect(out).toBe("ping()");
  });

  it("bestMatchSignature skips a zero-param candidate when calldata carries params (continue path)", () => {
    // calldata has 32 bytes of params (paramBytes=32). The first candidate is
    // zero-param: paramBytes !== 0 so it hits the `continue` (line 79) and the
    // second, matching candidate is returned.
    const calldata = "0xa9059cbb" + "0".repeat(64);
    const out = bestMatchSignature(
      [
        { textSignature: "ping()", hexSignature: "0x" },
        { textSignature: "foo(uint256)", hexSignature: "0x" },
      ] as never,
      calldata,
    );
    expect(out).toBe("foo(uint256)");
  });

  it("bestMatchSignature falls back to the shortest signature when no length heuristic matches", () => {
    // Both candidates expect params but calldata carries far more bytes than
    // 32*count*3, so neither length window matches → shortest-name fallback.
    const huge = "0xa9059cbb" + "0".repeat(64 * 50);
    const out = bestMatchSignature(
      [
        { textSignature: "aVeryLongFunctionName(uint256)", hexSignature: "0x" },
        { textSignature: "f(uint256)", hexSignature: "0x" },
      ] as never,
      huge,
    );
    expect(out).toBe("f(uint256)");
  });
});

// ---------------------------------------------------------------------------
// callTreeModel.ts — uncovered 54 & 70: the `if (d < frameDepth) break` guards.
// Line 54: a child whose execution returned above the parent before any deeper
// step (codeless callee). Line 70: in the codeless branch, the call-site scan
// also returns above the parent before finding a CALL op.
// ---------------------------------------------------------------------------
function frame(to: string, calls: CallFrame[] = []): CallFrame {
  return { type: "CALL", from: "0x0", to, gas: "0x0", gasUsed: "0x0", input: "0x", calls } as CallFrame;
}

describe("callTreeModel mop-up", () => {
  it("maps a codeless callee to the parent step when execution never goes deeper", () => {
    const child = frame("0xBBB");
    const root = frame("0xAAA", [child]);
    // root runs at depth 1; after entry the trace immediately drops to depth 0
    // (returns above the parent) so the child's entry scan hits `d < frameDepth`
    // (line 54) AND the call-site scan also hits `d < frameDepth` (line 70) with
    // no CALL op → child maps to the parent's frameStep (0).
    const steps: OpcodeStep[] = [
      { pc: 0, op: "JUMP", gas: 0, gasCost: 0, depth: 1, stack: [], memory: [], storage: {} },
      { pc: 1, op: "STOP", gas: 0, gasCost: 0, depth: 0, stack: [], memory: [], storage: {} },
    ];
    const map = mapFramesToSteps(root, steps);
    expect(map.get(root)).toBe(0);
    expect(map.get(child)).toBe(0); // collapsed to parent's frameStep
  });
});

// ---------------------------------------------------------------------------
// executionScopes.ts — uncovered: callSiteFuncName empty snippet (156),
// funcNameFromDefinition receive/fallback/constructor/modifier (180,181,183),
// indexFor's "no files for addr" return undefined (312), the onFnResolve dev
// hook block (417-440), and the public-double-entry dedupe `continue` (532).
// ---------------------------------------------------------------------------
function step(pc: number, depth: number, op = "JUMP"): OpcodeStep {
  return { pc, op, gas: 0, gasCost: 0, depth, stack: [], memory: [], storage: {} };
}
function loc(jumpType: string, snippet: string, line = 0, endLine = line): SourceLocation {
  return { file: "C.sol", line, column: 0, endLine, endColumn: 0, sourceSnippet: snippet, jumpType };
}
const kids = (n: ExecNode): ExecNode[] => (n.kind === "log" || n.kind === "op" ? [] : n.children);
const fns = (n: ExecNode) => kids(n).filter((c) => c.kind === "fn") as Extract<ExecNode, { kind: "fn" }>[];

describe("executionScopes mop-up", () => {
  it("names an internal fn whose definition snippet is a fallback() (no callSite)", () => {
    // defSnippet matches fallback(); callSnippet is empty so callSiteFuncName
    // returns null at line 156 (the `if (!snippet) return null` guard) and
    // funcNameFromDefinition hits the fallback branch (line 180).
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(20, 1), step(30, 1)];
    const maps = {
      "0xaaa": {
        10: loc("i", ""), // call-site snippet EMPTY → callSiteFuncName(null) path
        20: loc("-", "fallback() external payable {"),
        30: loc("o", ""),
      } as Record<number, SourceLocation>,
    };
    const tree = buildExecutionTree(root, new Map([[root, 0]]), steps, maps);
    expect(fns(tree)[0]!.name).toBe("fallback");
  });

  it("names an internal fn from a constructor definition snippet", () => {
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(20, 1), step(30, 1)];
    const maps = {
      "0xaaa": {
        10: loc("i", "deploy()"),
        20: loc("-", "constructor() public {"),
        30: loc("o", ""),
      } as Record<number, SourceLocation>,
    };
    const tree = buildExecutionTree(root, new Map([[root, 0]]), steps, maps);
    expect(fns(tree)[0]!.name).toBe("constructor");
  });

  it("names an internal fn from a modifier definition snippet", () => {
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(20, 1), step(30, 1)];
    const maps = {
      "0xaaa": {
        10: loc("i", "applyGuard()"),
        20: loc("-", "modifier nonReentrant() {"),
        30: loc("o", ""),
      } as Record<number, SourceLocation>,
    };
    const tree = buildExecutionTree(root, new Map([[root, 0]]), steps, maps);
    expect(fns(tree)[0]!.name).toBe("nonReentrant");
  });

  it("falls back gracefully when sourcesByAddr has no entry for the frame address (indexFor returns undefined)", () => {
    // sourcesByAddr is provided but keyed for a DIFFERENT contract, so indexFor
    // hits `if (!files) return undefined` (line 312). The snippet heuristic
    // still names the function.
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(20, 1), step(30, 1)];
    const maps = {
      "0xaaa": {
        10: loc("i", "doThing()"),
        20: loc("-", "function doThing() internal {"),
        30: loc("o", ""),
      } as Record<number, SourceLocation>,
    };
    const tree = buildExecutionTree(
      root,
      new Map([[root, 0]]),
      steps,
      maps,
      undefined,
      undefined,
      { "0xother": [{ name: "Other.sol", content: "contract O {}" }] },
    );
    expect(fns(tree)[0]!.name).toBe("doThing");
  });

  it("dedupes a function double-entry (two 'i' jumps resolving to the same name+line)", () => {
    // Two consecutive enter events resolving to the same fn name AND line → the
    // second hits the dedupe `continue` (line 532) so only one fn node appears.
    // The landing snippet is NOT a `function` decl (so flattenDecls doesn't
    // strip it); the name comes from the call-site snippet `foo()`, and the
    // entry line is fixed by the landing range start (line 100).
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(11, 1), step(12, 1), step(20, 1)];
    const maps = {
      "0xaaa": {
        10: loc("i", "foo()"), // call-site names foo; landing below
        11: loc("-", "uint256 z = 1;", 100, 105), // body line 100 (not a decl)
        12: loc("i", "foo()"), // second entry → resolves to same name+line 100
        20: loc("-", "uint256 z = 1;", 100, 105),
      } as Record<number, SourceLocation>,
    };
    const tree = buildExecutionTree(root, new Map([[root, 0]]), steps, maps);
    // Both enters resolve to foo@100; the dedupe keeps a single node.
    expect(fns(tree).filter((f) => f.name === "foo" && f.line === 100)).toHaveLength(1);
  });

  it("invokes the onFnResolve dev hook and enumerates fns inside the JUMPDEST range", () => {
    // Provide sourcesByAddr so fnIndex is built, a range spanning two fn decls,
    // and an onFnResolve callback so the whole 417-440 block runs.
    const root = frame("0xAAA");
    const steps = [step(0, 1), step(10, 1), step(20, 1), step(30, 1)];
    const maps = {
      "0xaaa": {
        // Call site names getStorageBytes32; landing range spans lines 2..10
        // which contains BOTH getStorageBool (line 5) and getStorageBytes32 (8).
        10: loc("i", "getStorageBytes32(name)", 2, 2),
        20: loc("-", "bytes32 location = key(name);", 2, 10),
        30: loc("o", ""),
      } as Record<number, SourceLocation>,
    };
    const sourcesByAddr = {
      "0xaaa": [
        {
          name: "C.sol",
          content: [
            "library Lib {", // 1
            "  function a() internal {}", // 2
            "", // 3
            "", // 4
            "  function getStorageBool() internal {}", // 5
            "", // 6
            "", // 7
            "  function getStorageBytes32() internal {}", // 8
            "", // 9
            "  function z() internal {}", // 10
            "}", // 11
          ].join("\n"),
        },
      ],
    };
    const resolves: Array<{
      classified: string | null;
      fnsInsideRange: Array<{ name: string; line: number }>;
      callSite: string | null;
    }> = [];
    buildExecutionTree(
      root,
      new Map([[root, 0]]),
      steps,
      maps,
      undefined,
      undefined,
      sourcesByAddr,
      (r) => resolves.push(r),
    );
    expect(resolves.length).toBeGreaterThan(0);
    const first = resolves[0]!;
    // fnsInsideRange enumerated the decls whose line falls in [2,10].
    const names = first.fnsInsideRange.map((f) => f.name);
    expect(names).toContain("getStorageBool");
    expect(names).toContain("getStorageBytes32");
    expect(first.callSite).toBe("getStorageBytes32");
  });
});

// ---------------------------------------------------------------------------
// opcodeOperands.ts — uncovered: PUSHn dynamic spec (100), SWAPn dynamic spec
// (111-115), toNum's no-hex guard (135) and BigInt-throw catch (141).
// ---------------------------------------------------------------------------
describe("describeOperands mop-up", () => {
  it("models PUSHn as producing one value and consuming none", () => {
    const info = describeOperands("PUSH1", [])!;
    expect(info.outputs).toBe(1);
    expect(info.inputIndices).toEqual([]);
    expect(info.signature).toBe("PUSH1()");
  });

  it("models SWAPn as swapping the top with the (n+1)th item", () => {
    // SWAP2 has 3 inputs (a, ·, b) and produces 3 outputs.
    const info = describeOperands("SWAP2", ["0xc", "0xb", "0xa"])!;
    expect(info.outputs).toBe(3);
    // The middle "·" placeholder is not surfaced as a named arg.
    expect(info.args.map((a) => a.name)).toEqual(["a", "b"]);
  });

  it("treats a missing memory size value as zero (toNum no-hex guard)", () => {
    // KECCAK256 reads memory[offset, size]. With an empty pre-stack the size
    // lookup yields undefined → toNum returns 0 (line 135). Offset arg present.
    const info = describeOperands("KECCAK256", ["0x20"])!;
    // offset resolves from the single stack entry (0x20=32); the size arg index
    // points past the stack → toNum(undefined) returns 0 via the no-hex guard.
    expect(info.memory).toEqual({ kind: "read", offset: 32, size: 0 });
  });

  it("treats an unparseable memory offset as zero (toNum catch)", () => {
    // A non-hex offset on the stack makes BigInt() throw → toNum returns 0.
    const info = describeOperands("MLOAD", ["not-a-hex"])!;
    expect(info.memory).toEqual({ kind: "read", offset: 0, size: 32 });
  });
});
