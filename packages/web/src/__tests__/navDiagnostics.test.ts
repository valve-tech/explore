import { describe, it, expect, beforeEach } from "vitest";
import {
  activeContractAt,
  locAt,
  publishNavContext,
  publishNavTree,
  publishNavState,
  publishFnResolves,
  type NavContext,
} from "../components/debugger/StepDebugger/navDiagnostics";
import type { OpcodeStep } from "../api/debugger";
import type { SourceLocation } from "../api/source";

// Supplemental coverage for navDiagnostics.ts — the dev-only window.__traceNav
// publishers and the pure step→contract→source resolvers behind them. The
// component gates these on import.meta.env.DEV, so they're never exercised by
// the prod render path; test them directly.

const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

function makeStep(o: Partial<OpcodeStep> = {}): OpcodeStep {
  return { pc: 0, op: "JUMPDEST", gas: 1, gasCost: 1, depth: 1, stack: [], memory: [], storage: {}, ...o };
}

const loc: SourceLocation = {
  file: "Token.sol",
  line: 3,
  column: 0,
  endLine: 3,
  endColumn: 10,
  sourceSnippet: "x = 1",
  jumpType: "-",
};

const ctx: NavContext = {
  steps: [makeStep({ pc: 0 }), makeStep({ pc: 7, depth: 2 })],
  frameRanges: [
    { addr: "0xroot", entry: 0, end: 2, depth: 1 },
    { addr: WPLS, entry: 1, end: 2, depth: 2 },
  ],
  traceSourceMaps: { [WPLS.toLowerCase()]: { 7: loc } },
};

beforeEach(() => {
  (window as unknown as { __traceNav?: unknown }).__traceNav = undefined;
});

describe("navDiagnostics resolvers", () => {
  it("activeContractAt returns the deepest covering frame", () => {
    expect(activeContractAt(ctx, 0)).toBe("0xroot");
    // Step 1 is covered by both frames; the deeper (depth 2) wins.
    expect(activeContractAt(ctx, 1)).toBe(WPLS);
  });

  it("activeContractAt returns null when no frame covers the step", () => {
    expect(activeContractAt(ctx, 99)).toBeNull();
  });

  it("locAt resolves the source location for the active contract", () => {
    const result = locAt(ctx, 1);
    expect(result).toMatchObject({ file: "Token.sol", line: 3, addr: WPLS });
  });

  it("locAt returns null for an out-of-range step", () => {
    expect(locAt(ctx, 99)).toBeNull();
  });

  it("locAt returns null when the active contract has no mapping for the pc", () => {
    // Step 0's active contract is 0xroot, which has no source map entry.
    expect(locAt(ctx, 0)).toBeNull();
  });
});

describe("navDiagnostics publishers", () => {
  it("publishNavContext exposes ctx + bound resolver helpers", () => {
    publishNavContext(ctx);
    const w = window as unknown as {
      __traceNav: {
        ctx: NavContext;
        activeContractAt: (s: number) => string | null;
        locAt: (s: number) => unknown;
      };
    };
    expect(w.__traceNav.ctx).toBe(ctx);
    expect(w.__traceNav.activeContractAt(1)).toBe(WPLS);
    expect(w.__traceNav.locAt(1)).toMatchObject({ addr: WPLS });
  });

  it("the publishers merge onto a shared window handle", () => {
    publishNavContext(ctx);
    publishNavTree({ kind: "call" });
    publishNavState({
      currentStep: 1,
      activeContract: WPLS,
      file: "Token.sol",
      effectiveLine: 3,
    });
    publishFnResolves([
      {
        jumpStep: 1,
        contract: WPLS,
        landingStep: 1,
        landingFile: "Token.sol",
        landingStart: 3,
        landingEnd: 3,
        fnsInsideRange: [],
        classified: "transfer",
        source: "fnIndex",
        callSite: "transfer",
        callSiteOverrode: false,
      },
    ]);
    const w = window as unknown as {
      __traceNav: {
        ctx: NavContext;
        tree: unknown;
        state: { currentStep: number };
        fnResolves: unknown[];
      };
    };
    // All four publishers wrote to the same object without clobbering.
    expect(w.__traceNav.ctx).toBe(ctx);
    expect(w.__traceNav.tree).toEqual({ kind: "call" });
    expect(w.__traceNav.state.currentStep).toBe(1);
    expect(w.__traceNav.fnResolves).toHaveLength(1);
  });
});
