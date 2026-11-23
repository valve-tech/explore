import { describe, expect, it } from "vitest";
import swapRaw from "../../../../../__tests__/fixtures/hoverValues/pulsexSwap.json";
import probeRaw from "../../../../../__tests__/fixtures/hoverValues/hoverProbe.json";
import { formatStackVar, wordOf } from "../formatStackValue";
import type { StackVar } from "../functionSignature";
import { findScopeEnd, walkStackScopes, type StackScope } from "../stackScopes";
import { stackValueAt } from "../stackValueAt";
import { positionOf, probeOf, type Probe } from "./loadTrace";

/**
 * The rule of this feature: a missing value is correct, a wrong value is a
 * bug. These tests ask for every parameter and every return variable of every
 * open function, at many steps of real traces, and compare each answer with
 * the real stacks of the trace.
 */

interface Tally {
  answered: number;
  missing: number;
  wrong: string[];
}

const isBlockEdge = (p: Probe, step: number) => {
  const op = p.trace.steps[step]!.op;
  return op === "JUMPDEST" || op === "JUMP" || op === "JUMPI";
};

function check(p: Probe, opts: { every: number; versions?: Record<string, string>; optimizer?: boolean }): { params: Tally; returns: Tally } {
  const { steps, stacks, frames, pcMaps } = p.trace;
  const params: Tally = { answered: 0, missing: 0, wrong: [] };
  const returns: Tally = { answered: 0, missing: 0, wrong: [] };
  for (const frame of frames) {
    const pcMap = pcMaps[frame.addr];
    if (!pcMap) continue;
    for (let i = frame.entry; i < frame.end; i += opts.every) {
      if (steps[i]!.depth !== frame.depth) continue;
      const walk = walkStackScopes(steps, p.heights, frame, pcMap, i);
      const seen = new Set<string>();
      for (const scope of [...(walk?.scopes ?? [])].reverse()) {
        // The hover resolves to the innermost call of a function.
        const key = `${scope.loc.file}:${scope.loc.line}:${scope.loc.column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const body = scope.fn.stripped.slice(scope.fn.bodyStart);
        const list: Array<[StackVar, number, boolean]> = [
          ...scope.fn.params.map((v): [StackVar, number, boolean] => [v, scope.base + v.offset, false]),
          ...scope.fn.returns.map((v): [StackVar, number, boolean] => [v, scope.base + scope.fn.paramSlots + v.offset, true]),
        ];
        for (const [v, index, isReturn] of list) {
          if (!v.name) continue;
          const tally = isReturn ? returns : params;
          const answer = stackValueAt({
            word: v.name, ...positionOf(scope.loc, v.name), steps, heights: p.heights, frames, currentStep: i,
            traceSourceMaps: pcMaps, detail: { stack: stacks[i]! }, compilerVersion: opts.versions?.[frame.addr],
            calldata: frame.input, optimizer: opts.optimizer,
          });
          if (!answer) {
            tally.missing++;
            continue;
          }
          tally.answered++;
          const at = (stack: readonly string[], from = index) =>
            formatStackVar(v, Array.from({ length: v.slots }, (_, q) => wordOf(stack[from + q] ?? "0x0")!), { calldata: frame.input })?.value;
          const allowed = new Set<string | undefined>();
          if (!isReturn) {
            // A parameter the function never assigns keeps the value it has at the entry.
            const name = v.name.replace(/[$]/g, "\\$");
            const assigned = new RegExp(`(?<![\\w$.])${name}\\s*(=[^=]|[-+*/%|&^]=|<<=|>>=|\\+\\+|--)|(\\+\\+|--)\\s*${name}\\b|\\bassembly\\b`).test(body);
            if (assigned) continue;
            allowed.add(at(stacks[scope.entryStep]!));
          } else {
            // A return variable holds its zero value, or the value its slot has
            // at an edge of the current basic block, or the value the function returns.
            allowed.add(formatStackVar(v, Array.from({ length: v.slots }, () => 0n), {})?.value);
            allowed.add(formatStackVar(v, [0x60n], {})?.value);
            for (let b = i; b > scope.entryStep; b--) {
              if (steps[b]!.depth !== frame.depth || !(steps[b]!.op === "JUMPDEST" || isBlockEdge(p, b - 1))) continue;
              if (stacks[b]!.length > index) allowed.add(at(stacks[b]!));
              break;
            }
            for (let b = i + 1; b < frame.end; b++) {
              if (steps[b]!.depth !== frame.depth || !isBlockEdge(p, b)) continue;
              if (stacks[b]!.length > index) allowed.add(at(stacks[b]!));
              break;
            }
            const end = findScopeEnd(steps, p.heights, frame, pcMap, scope, i);
            if (end.kind === "returns" && end.step + 1 < frame.end) {
              const after = stacks[end.step + 1]!;
              allowed.add(at(after, after.length - scope.fn.returnSlots + v.offset));
            }
          }
          if (!allowed.has(answer.value)) tally.wrong.push(`step ${i} ${describe_(scope)}.${v.name}: got ${answer.value}, allowed ${[...allowed].join(" | ")}`);
        }
      }
    }
  }
  return { params, returns };
}

const describe_ = (scope: StackScope) => `${scope.fn.name}@${scope.entryStep}`;
const rate = (t: Tally) => t.answered / (t.answered + t.missing);

describe("stackValueAt never gives a wrong value", () => {
  it("in the PulseX swap: 12 frames with a source map, every third step", { timeout: 120_000 }, () => {
    // Transaction 0xc1c8c8f0abd23ec35fc89a04a3c6a02d89b0d3a7f4ec3e6cd911e7bb0f0c5200, PulseChain.
    const p = probeOf(swapRaw);
    const contracts = (p.trace.meta.contracts ?? {}) as Record<string, { compilerVersion: string }>;
    const versions = Object.fromEntries(Object.entries(contracts).map(([addr, c]) => [addr, c.compilerVersion]));
    const { params, returns } = check(p, { every: 3, versions });
    expect(params.wrong).toEqual([]);
    expect(returns.wrong).toEqual([]);
    // The function must stay useful: it answers for most parameters.
    expect(params.answered).toBeGreaterThan(14_000);
    expect(rate(params)).toBeGreaterThan(0.95);
    expect(returns.answered).toBeGreaterThan(2_000);
    expect(rate(returns)).toBeGreaterThan(0.8);
  });

  it("in each legacy trace of the test contract, at every step", { timeout: 120_000 }, () => {
    const T = probeRaw.traces;
    const legacy = { legacyOptRun: T.legacyOptRun, legacyOptBump: T.legacyOptBump, legacyOptFail: T.legacyOptFail, legacyOptShadow: T.legacyOptShadow, legacyPush0Bump: T.legacyPush0Bump };
    for (const [name, raw] of Object.entries(legacy)) {
      const { params, returns } = check(probeOf(raw), { every: 1 });
      expect(params.wrong, name).toEqual([]);
      expect(returns.wrong, name).toEqual([]);
      expect(params.answered + returns.answered, name).toBeGreaterThan(10);
    }
  });

  it("in code with the optimizer off, with and without the optimizer flag", { timeout: 120_000 }, () => {
    for (const optimizer of [false, undefined]) {
      for (const raw of [probeRaw.traces.legacyRun, probeRaw.traces.legacyPush0Bump]) {
        const { params, returns } = check(probeOf(raw), { every: optimizer === false ? 2 : 5, optimizer });
        expect(params.wrong).toEqual([]);
        expect(returns.wrong).toEqual([]);
        expect(rate(params)).toBeGreaterThan(0.97);
      }
    }
  });

  it("in IR-pipeline code: it gives no answer", () => {
    for (const raw of [probeRaw.traces.irOptRun, probeRaw.traces.irSmall]) {
      const { params, returns } = check(probeOf(raw), { every: 1, versions: {} });
      expect(params.answered + returns.answered).toBe(0);
      expect(params.missing).toBeGreaterThan(300);
    }
  });
});
