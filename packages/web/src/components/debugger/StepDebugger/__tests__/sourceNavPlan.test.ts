import { describe, expect, it } from "vitest";
import { calleeSources, clickModifierOf, planGoto } from "../sourceNav/planGoto";
import type { NavTarget } from "../sourceNav/resolveClick";

const target = (over: Partial<NavTarget> = {}): NavTarget => ({ file: "A.sol", line: 10, kind: "function", owner: "A", hasBody: true, ...over });

describe("clickModifierOf", () => {
  it("maps the keys to one modifier", () => {
    expect(clickModifierOf({ metaKey: false, ctrlKey: false, altKey: false })).toBe("plain");
    expect(clickModifierOf({ metaKey: true, ctrlKey: false, altKey: false })).toBe("meta");
    expect(clickModifierOf({ metaKey: false, ctrlKey: true, altKey: false })).toBe("meta");
    expect(clickModifierOf({ metaKey: true, ctrlKey: false, altKey: true })).toBe("alt");
  });
});

describe("planGoto", () => {
  // pc 1 maps to A.sol:10. It runs at step 0 (another frame) and at step 3.
  const steps = [{ pc: 1 }, { pc: 2 }, { pc: 3 }, { pc: 1 }, { pc: 4 }];
  const pcMap = { 1: { file: "A.sol", line: 10 }, 2: { file: "A.sol", line: 11 } };
  const base = { displayAddr: "0xa", viewingOther: false, currentFile: "A.sol", frame: { entry: 2, end: 5 }, steps, pcMap };

  it("moves the cursor to a step inside the active frame only", () => {
    expect(planGoto(target(), base)).toEqual({ line: 10, ref: null, step: 3 });
  });
  it("leaves the cursor when the frame never runs the line", () => {
    expect(planGoto(target({ line: 11 }), base)).toEqual({ line: 11, ref: null, step: null });
  });
  it("shows another file of the same contract when no step maps there", () => {
    expect(planGoto(target({ file: "I.sol", line: 4 }), base)).toEqual({ line: 4, ref: { addr: "0xa", file: "I.sol" }, step: null });
  });
  it("shows the callee contract for a cross-contract target", () => {
    expect(planGoto(target({ addr: "0ximpl" }), base)).toEqual({ line: 10, ref: { addr: "0ximpl", file: "A.sol" }, step: null });
  });
  it("stays in the displayed contract when the pane shows another contract", () => {
    expect(planGoto(target(), { ...base, displayAddr: "0ximpl", viewingOther: true })).toEqual({ line: 10, ref: { addr: "0ximpl", file: "A.sol" }, step: null });
  });
});

describe("calleeSources", () => {
  const active = { addr: "0xA", entry: 0, end: 100, depth: 1 };
  const frames = [
    active,
    { addr: "0xFirst", entry: 10, end: 20, depth: 2 },
    { addr: "0xDeep", entry: 12, end: 15, depth: 3 },
    { addr: "0xProxy", entry: 30, end: 60, depth: 2 },
    { addr: "0xImpl", entry: 35, end: 55, depth: 3 },
    { addr: "0xOutside", entry: 120, end: 130, depth: 2 },
  ];
  const f = (name: string) => [{ name, content: "" }];
  const sources = { "0xfirst": f("first"), "0xproxy": f("proxy"), "0ximpl": f("impl"), "0xoutside": f("out") };
  const impl = new Map([["0xproxy", "0ximpl"]]);

  it("returns the next direct child of the frame", () => {
    expect(calleeSources(frames, active, 0, impl, sources).map((c) => c.addr)).toEqual(["0xfirst"]);
  });
  it("lists the implementation before the proxy", () => {
    expect(calleeSources(frames, active, 21, impl, sources).map((c) => c.addr)).toEqual(["0ximpl", "0xproxy"]);
  });
  it("never leaves the frame and drops contracts without source", () => {
    expect(calleeSources(frames, active, 61, impl, sources)).toEqual([]);
    expect(calleeSources(frames, active, 0, impl, {})).toEqual([]);
    expect(calleeSources(frames, null, 0, impl, sources)).toEqual([]);
  });
});
