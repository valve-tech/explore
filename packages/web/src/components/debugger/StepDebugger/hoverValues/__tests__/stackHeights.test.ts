import { describe, expect, it } from "vitest";
import swapRaw from "../../../../../__tests__/fixtures/hoverValues/pulsexSwap.json";
import probeRaw from "../../../../../__tests__/fixtures/hoverValues/hoverProbe.json";
import { computeStackHeights, stackEffect, writesSlot } from "../stackHeights";
import { loadTrace, type RawTrace } from "./loadTrace";

// Real data: PulseX swap 0xc1c8c8f0abd23ec35fc89a04a3c6a02d89b0d3a7f4ec3e6cd911e7bb0f0c5200
// on PulseChain (369), block 28132059. PulseXRouter02 calls two PulseXPair
// contracts, WPLS and two bridged tokens (proxy + PermittableToken): 16 frames,
// 8250 steps, with CALL, STATICCALL and DELEGATECALL.
const swap = loadTrace(swapRaw as unknown as RawTrace);

describe("stackEffect", () => {
  it("knows the fixed opcodes", () => {
    expect(stackEffect("ADD")).toEqual({ pops: 2, pushes: 1 });
    expect(stackEffect("CALL")).toEqual({ pops: 7, pushes: 1 });
    expect(stackEffect("STATICCALL")).toEqual({ pops: 6, pushes: 1 });
    expect(stackEffect("CREATE2")).toEqual({ pops: 4, pushes: 1 });
    expect(stackEffect("MCOPY")).toEqual({ pops: 3, pushes: 0 });
    expect(stackEffect("TSTORE")).toEqual({ pops: 2, pushes: 0 });
    expect(stackEffect("JUMPDEST")).toEqual({ pops: 0, pushes: 0 });
  });

  it("knows the opcode families", () => {
    expect(stackEffect("PUSH0")).toEqual({ pops: 0, pushes: 1 });
    expect(stackEffect("PUSH32")).toEqual({ pops: 0, pushes: 1 });
    expect(stackEffect("DUP3")).toEqual({ pops: 3, pushes: 4 });
    expect(stackEffect("SWAP16")).toEqual({ pops: 17, pushes: 17 });
    expect(stackEffect("LOG4")).toEqual({ pops: 6, pushes: 0 });
  });

  it("accepts both names of a renamed opcode", () => {
    expect(stackEffect("SHA3")).toEqual(stackEffect("KECCAK256"));
    expect(stackEffect("DIFFICULTY")).toEqual(stackEffect("PREVRANDAO"));
  });

  it("returns null for a name it does not know", () => {
    for (const op of ["opcode 0xfe not defined", "PUSH33", "DUP17", "SWAP0", "LOG5", ""]) {
      expect(stackEffect(op)).toBeNull();
    }
  });

  it("covers every opcode of the real traces", () => {
    const ops = new Set(swapRaw.ops);
    for (const t of Object.values(probeRaw.traces)) for (const op of t.ops) ops.add(op);
    expect(ops.has("PUSH0")).toBe(true);
    expect(ops.has("REVERT")).toBe(true);
    for (const op of ops) expect(stackEffect(op), op).not.toBeNull();
  });
});

describe("writesSlot", () => {
  it("is false for DUP, which only reads", () => {
    expect(writesSlot("DUP2", 5, 3)).toBe(false);
  });

  it("is true for the two items a SWAP exchanges, and for no other item", () => {
    expect(writesSlot("SWAP3", 10, 9)).toBe(true);
    expect(writesSlot("SWAP3", 10, 6)).toBe(true);
    expect(writesSlot("SWAP3", 10, 7)).toBe(false);
    expect(writesSlot("SWAP3", 10, 5)).toBe(false);
  });

  it("is true for each item another opcode removes", () => {
    expect(writesSlot("POP", 4, 3)).toBe(true);
    expect(writesSlot("POP", 4, 2)).toBe(false);
    expect(writesSlot("MSTORE", 4, 2)).toBe(true);
    expect(writesSlot("BOGUS", 4, 2)).toBeNull();
  });
});

describe("the fixture loader", () => {
  it("rebuilds the real stacks: index 0 is the bottom and the last item is the top", () => {
    const traces = [swap, ...Object.values(probeRaw.traces).map((t) => loadTrace(t as unknown as RawTrace))];
    let checked = 0;
    for (const t of traces) {
      for (const [step, real] of Object.entries(t.checkpoints)) {
        expect(t.stacks[Number(step)]).toEqual(real);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
    // Step 136 is the JUMPDEST of swapExactTokensForTokens. The selector is at
    // the bottom, and the last argument (deadline) is at the top.
    expect(swap.stacks[136]![0]).toBe("0x38ed1739");
    expect(swap.stacks[136]!.at(-1)).toBe("0x6b046287");
  });
});

describe("computeStackHeights", () => {
  it("equals the real stack length at each of the 8250 steps of the PulseX swap", () => {
    const heights = computeStackHeights(swap.steps);
    expect(heights.length).toBe(8250);
    expect(new Set(swap.steps.map((s) => s.depth)).size).toBe(4);
    const wrong = swap.realHeights.flatMap((h, i) => (heights[i] === h ? [] : [i]));
    expect(wrong).toEqual([]);
  });

  it("equals the real stack length in each compiled test trace, with PUSH0 and REVERT", () => {
    for (const [name, raw] of Object.entries(probeRaw.traces)) {
      const t = loadTrace(raw as unknown as RawTrace);
      const heights = computeStackHeights(t.steps);
      const wrong = t.realHeights.flatMap((h, i) => (heights[i] === h ? [] : [i]));
      expect(wrong, name).toEqual([]);
    }
  });

  it("starts a new frame at 0 and gives the caller the height after its call", () => {
    const steps = [
      { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 },
      { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 }, { op: "PUSH1", depth: 1 },
      { op: "CALL", depth: 1 },
      { op: "PUSH1", depth: 2 }, { op: "PUSH1", depth: 2 }, { op: "REVERT", depth: 2 },
      { op: "POP", depth: 1 }, { op: "STOP", depth: 1 },
    ];
    expect([...computeStackHeights(steps)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 2, 1]);
  });

  it("treats a call that runs no code as one opcode", () => {
    const steps = [
      ...Array.from({ length: 6 }, () => ({ op: "PUSH1", depth: 1 })),
      { op: "STATICCALL", depth: 1 },
      { op: "POP", depth: 1 },
    ];
    expect([...computeStackHeights(steps)].slice(6)).toEqual([6, 1]);
  });

  it("marks the frame unknown after an unknown opcode, and no other frame", () => {
    const steps = [
      ...Array.from({ length: 7 }, () => ({ op: "PUSH1", depth: 1 })),
      { op: "CALL", depth: 1 },
      { op: "PUSH1", depth: 2 }, { op: "MYSTERY", depth: 2 }, { op: "PUSH1", depth: 2 },
      { op: "POP", depth: 1 },
    ];
    expect([...computeStackHeights(steps)].slice(7)).toEqual([7, 0, 1, -1, 1]);
  });

  it("marks the frame unknown when an opcode needs more items than the stack has", () => {
    expect([...computeStackHeights([{ op: "POP", depth: 1 }, { op: "PUSH1", depth: 1 }])]).toEqual([0, -1]);
  });

  it("returns an empty array for an empty trace", () => {
    expect(computeStackHeights([]).length).toBe(0);
  });
});
