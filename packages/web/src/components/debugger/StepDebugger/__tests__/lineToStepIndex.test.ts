import { describe, it, expect } from "vitest";
import {
  activeFrame,
  buildFrameLineIndex,
  type FrameRange,
  type PcSourceMap,
  type StepLike,
} from "../lineToStepIndex";

describe("activeFrame", () => {
  it("picks the deepest frame containing the step", () => {
    const frames: FrameRange[] = [
      { addr: "0xroot", entry: 0, end: 10, depth: 1 },
      { addr: "0xchild", entry: 3, end: 7, depth: 2 },
    ];
    expect(activeFrame(frames, 5)).toEqual(frames[1]); // inside both — deepest wins
    expect(activeFrame(frames, 1)).toEqual(frames[0]); // only the root covers it
  });

  it("returns null when no frame contains the step", () => {
    const frames: FrameRange[] = [{ addr: "0xroot", entry: 0, end: 3, depth: 1 }];
    expect(activeFrame(frames, 5)).toBeNull();
    expect(activeFrame([], 0)).toBeNull();
  });
});

describe("buildFrameLineIndex", () => {
  it("resolves the CURRENT frame's line, not the globally-first contract's coincidental collision (the core bug)", () => {
    // Two contracts share the file name "C.sol" and — by PC coincidence — the
    // SAME pc (100), but their source maps disagree on which line pc 100
    // corresponds to. This is exactly the scenario the old buggy memo got
    // wrong: it scanned ALL steps against only the ACTIVE contract's map.
    const mapA: PcSourceMap = { 100: { file: "C.sol", line: 5 } };
    const mapB: PcSourceMap = { 100: { file: "C.sol", line: 42 } };

    // Frame A: contract 0xaaa, steps [0,5). Frame B: contract 0xbbb, steps [5,10).
    const frames: FrameRange[] = [
      { addr: "0xaaa", entry: 0, end: 5, depth: 1 },
      { addr: "0xbbb", entry: 5, end: 10, depth: 1 },
    ];
    const steps: StepLike[] = Array.from({ length: 10 }, () => ({ pc: 100 }));

    const currentStep = 7;
    const frame = activeFrame(frames, currentStep);
    expect(frame).toEqual(frames[1]); // frame B

    const result = buildFrameLineIndex(
      steps,
      { entry: frame!.entry, end: frame!.end },
      mapB,
      "C.sol",
    );
    // Frame B's own map (line 42), first step IN frame B (step 5) — not step 0.
    expect(result.executableLines).toEqual(new Set([42]));
    expect(result.lineToStep.get(42)).toBe(5);
    expect(result.lineToStep.has(5)).toBe(false);

    // Document the regression this closes: the OLD approach scanned every
    // step (0..9) against mapA (the single active-contract map) regardless
    // of which frame actually owned each step. That produces line 5 → step 0
    // — a different (wrong) answer than the frame-scoped fix above.
    const oldBuggyLines = new Set<number>();
    const oldBuggyFirstStep = new Map<number, number>();
    for (let i = 0; i < steps.length; i++) {
      const loc = mapA[steps[i]!.pc];
      if (loc && loc.file === "C.sol") {
        oldBuggyLines.add(loc.line);
        if (!oldBuggyFirstStep.has(loc.line)) oldBuggyFirstStep.set(loc.line, i);
      }
    }
    expect(oldBuggyLines).toEqual(new Set([5]));
    expect(oldBuggyFirstStep.get(5)).toBe(0);
    // The new, correct result differs from the old buggy one.
    expect(result.executableLines).not.toEqual(oldBuggyLines);
    expect(result.lineToStep.get(42)).not.toBe(oldBuggyFirstStep.get(5));
  });

  it("returns the first step IN the current frame, not the globally-first occurrence (loop/context)", () => {
    // Single contract. Line 8 executes at steps 1, 4, and 7 (e.g. loop
    // iterations or repeated calls). The current frame is scoped to [3,9) —
    // so only the occurrence at step 7 is "in scope" for this invocation.
    const pcMap: PcSourceMap = {
      1: { file: "C.sol", line: 8 },
    };
    const steps: StepLike[] = [
      { pc: 0 }, // 0
      { pc: 1 }, // 1 — line 8 (outside the frame)
      { pc: 0 }, // 2
      { pc: 0 }, // 3 — frame entry
      { pc: 1 }, // 4 — line 8 (first occurrence IN the frame)
      { pc: 0 }, // 5
      { pc: 0 }, // 6
      { pc: 1 }, // 7 — line 8 (also in the frame)
      { pc: 0 }, // 8 — frame end (exclusive)
    ];

    const result = buildFrameLineIndex(steps, { entry: 3, end: 9 }, pcMap, "C.sol");
    expect(result.executableLines).toEqual(new Set([8]));
    expect(result.lineToStep.get(8)).toBe(4); // first IN the frame, not step 1
  });

  it("scans the whole trace when range is null (single-contract fallback)", () => {
    const pcMap: PcSourceMap = {
      0: { file: "C.sol", line: 1 },
      1: { file: "C.sol", line: 2 },
    };
    const steps: StepLike[] = [{ pc: 0 }, { pc: 1 }, { pc: 0 }];

    const result = buildFrameLineIndex(steps, null, pcMap, "C.sol");
    expect(result.executableLines).toEqual(new Set([1, 2]));
    expect(result.lineToStep.get(1)).toBe(0);
    expect(result.lineToStep.get(2)).toBe(1);
  });

  it("returns empty sets when there's no current file or no pc map", () => {
    const steps: StepLike[] = [{ pc: 0 }];
    expect(buildFrameLineIndex(steps, null, undefined, "C.sol")).toEqual({
      executableLines: new Set(),
      lineToStep: new Map(),
    });
    expect(buildFrameLineIndex(steps, null, {}, null)).toEqual({
      executableLines: new Set(),
      lineToStep: new Map(),
    });
  });
});
