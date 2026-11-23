import { describe, expect, it } from "vitest";
import swapRaw from "../../../../../__tests__/fixtures/hoverValues/pulsexSwap.json";
import { entriesOf, frameOf, hover, probeOf, scopesAt } from "./loadTrace";
import { computeStackHeights } from "../stackHeights";
import { findScopeEnd } from "../stackScopes";

/**
 * Real data. PulseChain (369) transaction
 * 0xc1c8c8f0abd23ec35fc89a04a3c6a02d89b0d3a7f4ec3e6cd911e7bb0f0c5200, block 28132059:
 * swapExactTokensForTokens on PulseXRouter02 (0x165C3410fC91EF562C50559f7d2289fEbed552d9,
 * solc 0.6.6, optimizer on) through two PulseXPair contracts (solc 0.5.16), WPLS
 * (0xA1077a294dDE1B09bB078844df40758a5D0f9a27, solc 0.6.6) and PermittableToken
 * (0x539a69de74e9ed69fbe7f909fa935d05b8caba11, solc 0.4.24) behind two proxies.
 * The trace is a replay on an Anvil fork of block 28132058. The replay uses the
 * same gas as the transaction on chain (170867). Source maps come from Sourcify.
 *
 * The expected values below do NOT come from the stack. They come from the
 * call data, the getReserves and balanceOf results, and the return data of the
 * transaction (decoded with cast).
 */
const p = probeOf(swapRaw);
const meta = p.trace.meta as { contracts: Record<string, { compilerVersion: string }> };
const ROUTER = frameOf(p, 0);
const TOKEN_IMPL = frameOf(p, 4); // PermittableToken, by DELEGATECALL
const PAIR_1 = frameOf(p, 5); // first PulseXPair.swap
const WPLS = frameOf(p, 6); // WPLS.transfer
const TOKEN_IMPL_2 = frameOf(p, 12);

const TOKEN_IN = "0x579e9e0D22c2c092b2C6091F33A389b5D929Eb06";
const WPLS_ADDR = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TOKEN_OUT = "0x17C36b342F6C93dF7A872D625784ee0b402cd272";
const TRADER = "0xf310818d64068f8CeE5fc5dEd155F90E0970B801";
const PAIR_1_ADDR = "0xE0f07d8020aE05dECC4fcc10396B434Df30fe5B3";
const PAIR_2_ADDR = "0xCcE726B72352d5215BCFceE9F9Ee3bdEA5Ad814d";
const PATH = `[${TOKEN_IN}, ${WPLS_ADDR}, ${TOKEN_OUT}]`;
const AMOUNTS = ["350852270", "29763367701588581126167", "145458283746248608"];

const value = (step: number, fn: string, word: string, extra = {}) => hover(p, step, fn, word, extra)?.value ?? null;

describe("stackValueAt on a real PulseX swap", () => {
  it("reads the arguments of the external function, with a two-slot calldata array between them", () => {
    const entry = entriesOf(p, ROUTER, "swapExactTokensForTokens")[0]!;
    expect(entry).toBe(136);
    // Steps of the router frame: at the entry, between the calls, and near the end.
    for (const step of [entry, entry + 20, 1136, 5400, 8100]) {
      expect(p.trace.steps[step]!.depth).toBe(ROUTER.depth);
      expect(value(step, "swapExactTokensForTokens", "amountIn")).toBe("350852270");
      expect(value(step, "swapExactTokensForTokens", "amountOutMin")).toBe("141094535233861152");
      expect(value(step, "swapExactTokensForTokens", "to")).toBe(TRADER);
      expect(value(step, "swapExactTokensForTokens", "deadline")).toBe("1795449479");
    }
    expect(hover(p, entry + 20, "swapExactTokensForTokens", "amountIn")).toEqual({
      name: "amountIn", type: "uint", value: "350852270", source: "stack",
    });
  });

  it("decodes the calldata array when the caller gives the call data", () => {
    const step = entriesOf(p, ROUTER, "swapExactTokensForTokens")[0]! + 20;
    expect(hover(p, step, "swapExactTokensForTokens", "path", { calldata: ROUTER.input })).toEqual({
      name: "path", type: "address[] calldata", value: PATH, source: "calldata",
    });
    expect(hover(p, step, "swapExactTokensForTokens", "path")).toEqual({
      name: "path", type: "address[] calldata", value: "calldata @0xc4 (length 3)", source: "stack",
      note: "calldata reference: contents not decoded",
    });
  });

  it("reads the parameters of an internal library function for each call", () => {
    // Reserves come from the getReserves() results of the two pairs.
    const [first, second] = entriesOf(p, ROUTER, "getAmountOut");
    expect(value(first! + 5, "getAmountOut", "amountIn")).toBe(AMOUNTS[0]);
    expect(value(first! + 5, "getAmountOut", "reserveIn")).toBe("96364388715");
    expect(value(first! + 5, "getAmountOut", "reserveOut")).toBe("8228286635374274338441322");
    expect(value(second! + 5, "getAmountOut", "amountIn")).toBe(AMOUNTS[1]);
    expect(value(second! + 5, "getAmountOut", "reserveIn")).toBe("4356936270372301104273412");
    expect(value(second! + 5, "getAmountOut", "reserveOut")).toBe("21500424098843174505");
  });

  it("reads a named return variable until the return block writes its slot", () => {
    entriesOf(p, ROUTER, "getAmountOut").forEach((entry, call) => {
      const scope = scopesAt(p, entry + 1).at(-1)!;
      const end = findScopeEnd(p.trace.steps, p.heights, ROUTER, p.trace.pcMaps[ROUTER.addr]!, scope, entry);
      if (end.kind !== "returns") throw new Error("getAmountOut must return");
      const seen: string[] = [];
      for (let step = entry; step <= end.step; step++) {
        if (p.trace.steps[step]!.depth !== ROUTER.depth) continue;
        const v = value(step, "getAmountOut", "amountOut");
        if (v !== null && seen.at(-1) !== v) seen.push(v);
      }
      // The last block of getAmountOut assigns amountOut and then moves it for
      // the return. In optimized code the two writes look the same, so the
      // function gives null after the first write. It never shows another value.
      expect(seen, `call ${call}`).toEqual(["0"]);
      expect(value(end.step, "getAmountOut", "amountOut")).toBeNull();
      // The slot does not exist at the entry JUMPDEST.
      expect(value(entry, "getAmountOut", "amountOut")).toBeNull();
    });
  });

  it("reads a return variable that an earlier block assigns, and never a temporary value", () => {
    // SafeMath.mul: the optimizer pops the zero of 'z' and reuses its stack
    // index for a copy of 'y' before it computes x * y.
    const entry = entriesOf(p, ROUTER, "mul")[0]!;
    const seen = new Set<string>();
    for (let step = entry; step < entry + 30; step++) {
      const v = value(step, "mul", "z");
      if (v !== null) seen.add(v);
    }
    expect(value(entry + 5, "mul", "y")).toBe("9971");
    expect([...seen]).toEqual(["0", "3498347984170"]); // 350852270 * 9971
  });

  it("decodes memory arrays when the step has memory", () => {
    const entry = entriesOf(p, ROUTER, "_swap")[0]!;
    const step = entry + 3; // the fixture holds the real memory of this step
    expect(hover(p, step, "_swap", "amounts")).toEqual({
      name: "amounts", type: "uint[] memory", value: `[${AMOUNTS.join(", ")}]`, source: "memory",
    });
    expect(hover(p, step, "_swap", "path")).toEqual({ name: "path", type: "address[] memory", value: PATH, source: "memory" });
    expect(value(step, "_swap", "_to")).toBe(TRADER);
    // No memory for this step: the pointer, with a note.
    expect(hover(p, entry + 4, "_swap", "amounts")).toMatchObject({
      value: "memory @0x100", source: "stack", note: "memory pointer: contents not decoded",
    });
  });

  it("reads a variable of an outer function while an inner function runs", () => {
    const inner = entriesOf(p, ROUTER, "getAmountOut")[1]! + 5;
    expect(scopesAt(p, inner).map((s) => s.fn.name)).toEqual(["swapExactTokensForTokens", "getAmountsOut", "getAmountOut"]);
    expect(value(inner, "getAmountsOut", "amountIn")).toBe(AMOUNTS[0]);
    expect(value(inner, "swapExactTokensForTokens", "deadline")).toBe("1795449479");
  });

  it("reads the frame of a called contract with that contract's source map", () => {
    const swap = entriesOf(p, PAIR_1, "swap")[0]!;
    expect(value(swap + 9, "swap", "amount0Out")).toBe("0");
    expect(value(swap + 9, "swap", "amount1Out")).toBe(AMOUNTS[1]);
    expect(value(swap + 9, "swap", "to")).toBe(PAIR_2_ADDR);
    expect(hover(p, swap + 9, "swap", "data", { calldata: PAIR_1.input })).toEqual({
      name: "data", type: "bytes calldata", value: "0x", source: "calldata",
    });
    // Balances come from the balanceOf results, reserves from getReserves.
    const update = entriesOf(p, PAIR_1, "_update")[0]! + 3;
    expect(value(update, "_update", "balance0")).toBe("96715240985");
    expect(value(update, "_update", "balance1")).toBe("8198523267672685757315155");
    expect(hover(p, update, "_update", "_reserve0")).toMatchObject({ type: "uint112", value: "96364388715" });
    expect(value(update, "_update", "_reserve1")).toBe("8228286635374274338441322");
  });

  it("reads a public function that another function calls internally (WPLS.transfer calls transferFrom)", () => {
    const step = entriesOf(p, WPLS, "transferFrom")[0]! + 4;
    expect(value(step, "transferFrom", "src")).toBe(PAIR_1_ADDR);
    expect(value(step, "transferFrom", "dst")).toBe(PAIR_2_ADDR);
    expect(value(step, "transferFrom", "wad")).toBe(AMOUNTS[1]);
    expect(value(step, "transfer", "dst")).toBe(PAIR_2_ADDR);
    expect(value(step, "transfer", "wad")).toBe(AMOUNTS[1]);
  });

  it("needs the compiler version for a 0.4 contract, which has no dispatcher jump of type 'i'", () => {
    const version = meta.contracts[TOKEN_IMPL_2.addr]!.compilerVersion;
    expect(version).toBe("0.4.24+commit.e67f0147");
    const step = entriesOf(p, TOKEN_IMPL_2, "superTransfer")[0]! + 3;
    expect(value(step, "superTransfer", "_to")).toBeNull();
    expect(value(step, "superTransfer", "_to", { compilerVersion: "0.8.20" })).toBeNull();
    expect(value(step, "superTransfer", "_to", { compilerVersion: version })).toBe(TRADER);
    expect(value(step, "superTransfer", "_value", { compilerVersion: version })).toBe(AMOUNTS[2]);
    const sub = entriesOf(p, TOKEN_IMPL, "sub")[0]! + 3;
    expect(value(sub, "sub", "_b", { compilerVersion: version })).toBe(AMOUNTS[0]);
  });

  describe("returns null", () => {
    const entry = entriesOf(p, ROUTER, "getAmountOut")[0]!;
    const step = entry + 5;

    it("before the function is open, and after it returns", () => {
      expect(value(entry - 1, "getAmountOut", "amountIn")).toBeNull(); // at the JUMP
      expect(value(entry, "getAmountOut", "amountIn")).toBe(AMOUNTS[0]);
      const second = entriesOf(p, ROUTER, "getAmountOut")[1]!;
      expect(value(second - 40, "getAmountOut", "amountIn")).toBeNull();
      expect(value(step, "_swap", "_to")).toBeNull();
    });

    it("for a word that is not a parameter or a return variable", () => {
      expect(value(step, "getAmountOut", "amountInWithFee")).toBeNull(); // a local
      expect(value(step, "getAmountOut", "require")).toBeNull();
      expect(value(step, "getAmountOut", "mul")).toBeNull(); // a member name
    });

    it("when the pointer is not on that word", () => {
      expect(value(step, "getAmountOut", "amountIn", { col: 0 })).toBeNull();
      expect(value(step, "getAmountOut", "amountIn", { line: 1 })).toBeNull();
      expect(value(step, "getAmountOut", "amountIn", { file: "Other.sol" })).toBeNull();
    });

    it("when the step has no detail, or the stack length does not agree with the skeleton", () => {
      expect(value(step, "getAmountOut", "amountIn", { detail: null })).toBeNull();
      const short = p.trace.stacks[step]!.slice(1);
      expect(value(step, "getAmountOut", "amountIn", { detail: { stack: short } })).toBeNull();
    });

    it("when the slot under the parameters does not hold the return label", () => {
      const scope = scopesAt(p, step).at(-1)!;
      const stack = p.trace.stacks[step]!.slice();
      stack[scope.base - 1] = "0x1";
      expect(value(step, "getAmountOut", "amountIn", { detail: { stack } })).toBeNull();
    });

    it("when the cursor is in another frame, or the pane shows another contract", () => {
      // The cursor is in the pair. The router function is open, but its stack is not loaded.
      const inPair = entriesOf(p, PAIR_1, "swap")[0]! + 9;
      expect(value(inPair, "swapExactTokensForTokens", "amountIn", { locAddr: ROUTER.addr, sourceAddr: ROUTER.addr })).toBeNull();
      expect(value(inPair, "swapExactTokensForTokens", "amountIn", { locAddr: ROUTER.addr })).toBeNull();
      expect(value(step, "getAmountOut", "amountIn", { sourceAddr: PAIR_1.addr })).toBeNull();
      expect(value(step, "getAmountOut", "amountIn", { sourceAddr: ROUTER.addr.toUpperCase().replace("0X", "0x") })).toBe(AMOUNTS[0]);
    });

    it("in a frame with no source map (the unverified proxy)", () => {
      const proxy = frameOf(p, 3);
      expect(p.trace.pcMaps[proxy.addr]).toBeUndefined();
      const step2 = proxy.entry + 5;
      expect(
        hover(p, step, "getAmountOut", "amountIn", { currentStep: step2, detail: { stack: p.trace.stacks[step2]! } }),
      ).toBeNull();
    });

    it("when the caller says the contract uses the IR pipeline", () => {
      expect(value(step, "getAmountOut", "amountIn", { viaIR: true })).toBeNull();
    });
  });

  describe("a trace that stops before the function returns", () => {
    // The API has a step limit, and a revert ends a frame early. Cut the
    // trace at step 1000: swapExactTokensForTokens is open and never returns.
    const NOTE = "not cross-checked: this function does not return in the trace";
    const steps = p.trace.steps.slice(0, 1000);
    const cut = { steps, heights: computeStackHeights(steps), frames: [{ ...ROUTER, end: 1000 }] };

    it("adds a note when nothing confirms the return label", () => {
      expect(hover(p, 200, "swapExactTokensForTokens", "amountIn", cut)).toEqual({
        name: "amountIn", type: "uint", value: "350852270", source: "stack", note: NOTE,
      });
      // The same step in the full trace has no note: the function returns to the label.
      expect(hover(p, 200, "swapExactTokensForTokens", "amountIn")?.note).toBeUndefined();
    });

    it("has no note when the call data confirms the arguments", () => {
      expect(hover(p, 200, "swapExactTokensForTokens", "to", { ...cut, calldata: ROUTER.input })).toEqual({
        name: "to", type: "address", value: TRADER, source: "stack",
      });
      // Call data with another amountIn does not confirm the slots.
      const other = ROUTER.input.slice(0, 10) + "0".repeat(63) + "1" + ROUTER.input.slice(74);
      expect(hover(p, 200, "swapExactTokensForTokens", "to", { ...cut, calldata: other })?.note).toBe(NOTE);
    });

    it("has no note for an internal call whose return label is the pc after its jump", () => {
      const step = entriesOf(p, ROUTER, "getAmountOut")[0]! + 5;
      const scope = scopesAt(p, step).at(-1)!;
      expect(BigInt(p.trace.stacks[step]![scope.base - 1]!)).toBe(BigInt(p.trace.steps[scope.jumpStep]!.pc + 1));
      expect(hover(p, step, "getAmountOut", "reserveIn", cut)).toEqual({
        name: "reserveIn", type: "uint", value: "96364388715", source: "stack",
      });
    });

    it("returns null when the label slot holds a value that cannot be a code offset", () => {
      const scope = scopesAt(p, 200)[0]!;
      const stack = p.trace.stacks[200]!.slice();
      stack[scope.base - 1] = "0x10000";
      expect(hover(p, 200, "swapExactTokensForTokens", "amountIn", { ...cut, detail: { stack } })).toBeNull();
    });
  });
});
