import { describe, expect, it } from "vitest";
import probeRaw from "../../../../../__tests__/fixtures/hoverValues/hoverProbe.json";
import { buildSolIndex } from "../../sourceNav/solIndex";
import { findScopeEnd, looksViaIr, walkStackScopes } from "../stackScopes";
import { userTypeResolver } from "../userTypes";
import { entriesOf, frameOf, hover, probeOf, scopesAt, type Probe } from "./loadTrace";

/**
 * Traces of the test contract HoverProbe (source in the fixture), compiled by
 * solc and run on a local Anvil node. The contract is not on a public chain.
 * Each build ran the same calls:
 *   run(0x5Ee1151C8152242584dba6BB1F73544aD9f97b34, -42, true, 0xdeadbeef, Mode.Auto, "hover me", [10, 20, 30])
 *   bump(5), fail(3, "nope") (reverts), shadow(9)
 * The expected values come from the Solidity source and these arguments.
 */
const T = probeRaw.traces;
const optRun = probeOf(T.legacyOptRun); // solc 0.8.17, legacy pipeline, optimizer on
const plainRun = probeOf(T.legacyRun); // solc 0.8.17, legacy pipeline, optimizer off
const optBump = probeOf(T.legacyOptBump);
const push0Bump = probeOf(T.legacyPush0Bump); // solc 0.8.24, shanghai: PUSH0
const optFail = probeOf(T.legacyOptFail);
const optShadow = probeOf(T.legacyOptShadow);
const irRun = probeOf(T.irOptRun); // solc 0.8.17, via-IR, optimizer on
const irSmall = probeOf(T.irSmall); // Small.sol, via-IR, optimizer off

const WHO = "0x5Ee1151C8152242584dba6BB1F73544aD9f97b34";
const ZERO = "0x" + "0".repeat(64);
const DIGEST = "0xe699a032fc29ec6ebf095ac0cb1bc3138eca7b36ddc4696c51cbdcf1b9c42655"; // keccak256("hover me" ++ uint256(3) ++ uint128(1))

const value = (p: Probe, step: number, fn: string, word: string, extra = {}) => hover(p, step, fn, word, extra)?.value ?? null;
const entry = (p: Probe, fn: string, call = 0) => entriesOf(p, frameOf(p), fn)[call]!;

/** The different values the hover gives for a word while its function is open, in order. */
function history(p: Probe, fn: string, word: string, extra = {}): string[] {
  const seen: string[] = [];
  const frame = frameOf(p);
  const first = entry(p, fn);
  const scope = scopesAt(p, first + 1).at(-1)!;
  const end = findScopeEnd(p.trace.steps, p.heights, frame, p.trace.pcMaps[frame.addr]!, scope, first);
  const lastStep = end.kind === "returns" ? end.step : frame.end - 1;
  for (let step = first; step <= lastStep; step++) {
    const v = value(p, step, fn, word, extra);
    if (v !== null && seen.at(-1) !== v) seen.push(v);
  }
  return seen;
}

describe("stackValueAt on compiled test contracts (legacy pipeline)", () => {
  it("formats each value type by its declared type", () => {
    for (const p of [optRun, plainRun]) {
      const step = entry(p, "_mix") + 2;
      expect(hover(p, step, "_mix", "who")).toEqual({ name: "who", type: "address", value: WHO, source: "stack" });
      expect(hover(p, step, "_mix", "delta")).toEqual({ name: "delta", type: "int64", value: "-42", source: "stack" });
      expect(hover(p, step, "_mix", "flag")).toEqual({ name: "flag", type: "bool", value: "true", source: "stack" });
      expect(hover(p, step, "_mix", "tag")).toEqual({ name: "tag", type: "bytes4", value: "0xdeadbeef", source: "stack" });
    }
  });

  it("shows an enum as its number and member when the caller gives a type resolver", () => {
    const step = entry(optRun, "_mix") + 2;
    expect(hover(optRun, step, "_mix", "mode")).toEqual({
      name: "mode", type: "Mode", source: "stack",
      value: "0x0000000000000000000000000000000000000000000000000000000000000002",
      note: "raw stack word: type Mode not decoded",
    });
    const files = Object.entries(probeRaw.sources).map(([name, content]) => ({ name, content }));
    const resolveType = userTypeResolver(buildSolIndex(files));
    expect(hover(optRun, step, "_mix", "mode", { resolveType })).toEqual({ name: "mode", type: "Mode", value: "Auto (2)", source: "stack" });
  });

  it("accepts the pointer on a use in the body, not only on the declaration", () => {
    const step = entry(optRun, "_mix") + 2;
    expect(value(optRun, step, "_mix", "who", { use: 1 })).toBe(WHO); // uint160(who) % 7
    expect(value(optRun, step, "_mix", "delta", { use: 2 })).toBe("-42"); // uint64(-delta)
  });

  it("reads the external arguments: two calldata values of two slots each", () => {
    const frame = frameOf(optRun);
    const step = entry(optRun, "run") + 4;
    expect(value(optRun, step, "run", "who")).toBe(WHO);
    expect(value(optRun, step, "run", "delta")).toBe("-42");
    expect(hover(optRun, step, "run", "label", { calldata: frame.input })).toEqual({
      name: "label", type: "string calldata", value: '"hover me"', source: "calldata",
    });
    expect(hover(optRun, step, "run", "xs", { calldata: frame.input })).toEqual({
      name: "xs", type: "uint256[] calldata", value: "[10, 20, 30]", source: "calldata",
    });
    expect(value(optRun, step, "run", "label")).toBe("calldata @0x104 (length 8)");
    expect(value(optRun, step, "run", "xs")).toBe("calldata @0x144 (length 3)");
  });

  it("decodes a memory string, and shows a struct as a pointer", () => {
    for (const p of [optRun, plainRun]) {
      const step = entry(p, "_hash") + 3; // the fixture holds the real memory of this step
      expect(hover(p, step, "_hash", "text")).toEqual({ name: "text", type: "string memory", value: '"hover me"', source: "memory" });
      expect(value(p, step, "_hash", "n")).toBe("3");
      expect(hover(p, step, "_hash", "p")).toEqual({
        name: "p", type: "Pair memory", value: "memory @0xc0", source: "stack", note: "memory pointer: contents not decoded",
      });
    }
  });

  it("reads the innermost call of a recursive function", { timeout: 60_000 }, () => {
    for (const p of [optRun, plainRun]) {
      const entries = entriesOf(p, frameOf(p), "_sum");
      expect(entries.length).toBe(4);
      entries.forEach((e, depth) => {
        expect(scopesAt(p, e + 2).filter((s) => s.fn.name === "_sum").length).toBe(depth + 1);
        expect(value(p, e + 2, "_sum", "i")).toBe(String(depth));
      });
    }
    expect(hover(optRun, entry(optRun, "_sum") + 3, "_sum", "ys")).toMatchObject({ value: "[10, 20, 30]", source: "memory" });
    // After each inner call returns, the hover goes back to the outer call.
    const afterReturns = history(optRun, "_sum", "i");
    expect(afterReturns).toEqual(["0", "1", "2", "3", "2", "1", "0"]);
  });

  it("shows a storage reference as its slot", () => {
    const step = entry(optRun, "_credit") + 2;
    expect(hover(optRun, step, "_credit", "book")).toEqual({
      name: "book", type: "mapping(address=>uint256) storage", value: "storage slot 0x1", source: "stack",
      note: "storage reference: contents not decoded",
    });
    expect(value(optRun, step, "_credit", "who")).toBe(WHO);
    expect(value(optRun, step, "_credit", "amount")).toBe("115"); // 55 + 10 + 20 + 30
  });

  it("follows a return variable through its assignments (optimizer off)", { timeout: 60_000 }, () => {
    // out = 6; out += 1; out += 42; out += 4 + 2 + 0.
    const off = { optimizer: false };
    expect(history(plainRun, "_mix", "out", off)).toEqual(["0", "6", "7", "49", "55"]);
    expect(history(plainRun, "run", "sum", off)).toEqual(["0", "55", "115"]);
    expect(history(plainRun, "run", "digest", off)).toEqual([ZERO, DIGEST]);
    expect(history(plainRun, "_hash", "h", off)).toEqual([ZERO, DIGEST]);
    expect(history(push0Bump, "_twice", "result", off)).toEqual(["0", "14"]); // 6 * 2 + 2
    // When the caller does not say that the optimizer is off, the last block
    // of the function gives null: 55 is assigned there.
    expect(history(plainRun, "_mix", "out")).toEqual(["0", "6", "7", "49"]);
    expect(history(push0Bump, "_twice", "result")).toEqual(["0"]);
  });

  it("gives only true values of a return variable with the optimizer on", { timeout: 60_000 }, () => {
    const out = history(optRun, "_mix", "out");
    expect(out.slice(0, 3)).toEqual(["0", "6", "7"]);
    expect(out.every((v) => ["0", "6", "7", "49", "55"].includes(v))).toBe(true);
    expect(history(optRun, "run", "sum")).toEqual(["0", "55", "115"]);
    // The optimizer does not push the zero of 'h' at the entry of _hash. Its
    // stack index holds temporary values in that block. The function gives null.
    expect(history(optRun, "_hash", "h").every((v) => v === ZERO || v === DIGEST)).toBe(true);
    expect(value(optRun, entry(optRun, "_hash") + 3, "_hash", "h")).toBeNull();
    expect(value(plainRun, entry(plainRun, "_hash") + 3, "_hash", "h")).toBe(ZERO);
  });

  it("follows an assignment to a parameter", () => {
    // amount = amount + 1, with amount = 5.
    for (const p of [optBump, push0Bump]) {
      expect(history(p, "bump", "amount")).toEqual(["5", "6"]);
      expect(value(p, entry(p, "_twice") + 2, "_twice", "value")).toBe("6");
    }
    expect(hover(optBump, entry(optBump, "_twice") + 3, "_twice", "memo")).toEqual({
      name: "memo", type: "bytes memory", value: "0x7832", source: "memory", // "x2"
    });
    expect(history(optBump, "_twice", "result").every((v) => v === "0" || v === "14")).toBe(true);
  });

  it("returns null for a parameter that a local of the same name shadows", () => {
    const p = optShadow;
    const first = entry(p, "shadow");
    for (let step = first; step < first + 30; step++) expect(value(p, step, "shadow", "amount")).toBeNull();
    const r = history(p, "shadow", "r");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((v) => ["0", "9", "16"].includes(v))).toBe(true);
  });

  describe("a call that reverts", () => {
    const frame = frameOf(optFail);

    it("reads the internal function with no note: its return label is the pc after the jump", () => {
      const step = entry(optFail, "_check") + 3;
      expect(hover(optFail, step, "_check", "code")).toEqual({ name: "code", type: "uint256", value: "3", source: "stack" });
      expect(hover(optFail, step, "_check", "why")).toEqual({ name: "why", type: "string memory", value: '"nope"', source: "memory" });
      expect(value(optFail, step, "_check", "seen")).toBe("14"); // 'total' after bump(5)
    });

    it("reads the external function too", () => {
      const step = entry(optFail, "fail") + 2;
      expect(hover(optFail, step, "fail", "code")).toEqual({ name: "code", type: "uint256", value: "3", source: "stack" });
      expect(hover(optFail, step, "fail", "why", { calldata: frame.input })).toEqual({
        name: "why", type: "string calldata", value: '"nope"', source: "calldata",
      });
    });
  });
});

describe("stackValueAt on IR-pipeline (via-IR) code", () => {
  const all = (p: Probe, extra = {}) => {
    const frame = frameOf(p);
    const answers: unknown[] = [];
    for (let step = frame.entry; step < frame.end; step++) {
      for (const scope of scopesAt(p, step)) {
        for (const v of [...scope.fn.params, ...scope.fn.returns]) {
          if (v.name) answers.push(hover(p, step, scope.fn.name, v.name, extra));
        }
      }
    }
    return answers;
  };

  it("finds function scopes in the trace, with the arguments in the opposite order", { timeout: 60_000 }, () => {
    // f(9, 4) calls _g(9, 4). At the entry of _g the IR code has y on top of x.
    const e = entriesOf(irSmall, frameOf(irSmall), "_g")[0]!;
    expect(irSmall.trace.stacks[e]!.slice(-2)).toEqual(["0x4", "0x9"]);
    expect(all(irSmall).length).toBeGreaterThan(500);
    expect(all(irRun).length).toBeGreaterThan(500);
  });

  it("returns null for every variable at every step", { timeout: 60_000 }, () => {
    for (const extra of [{}, { compilerVersion: "0.8.17+commit.8df45f5f" }, { viaIR: true }]) {
      expect(all(irSmall, extra).every((a) => a === null)).toBe(true);
      expect(all(irRun, extra).every((a) => a === null)).toBe(true);
    }
  });

  it("detects the pipeline from the source map, and has a second guard in the dispatcher", () => {
    for (const p of [irSmall, irRun]) {
      const frame = frameOf(p);
      const pcMap = p.trace.pcMaps[frame.addr]!;
      expect(looksViaIr(pcMap)).toBe(true);
      expect(walkStackScopes(p.trace.steps, p.heights, frame, pcMap, frame.end)!.legacyDispatch).toBe(false);
    }
    for (const p of [optRun, plainRun, optBump, push0Bump, optFail, optShadow]) {
      const frame = frameOf(p);
      const pcMap = p.trace.pcMaps[frame.addr]!;
      expect(looksViaIr(pcMap)).toBe(false);
      expect(walkStackScopes(p.trace.steps, p.heights, frame, pcMap, frame.end)!.legacyDispatch).toBe(true);
    }
  });
});
