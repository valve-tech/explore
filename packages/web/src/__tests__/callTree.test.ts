import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { toCallTree } from "../components/explorer/TxDetail/callTreeLayout";
import {
  argumentTypes,
  calldataBytes,
  decodeArguments,
  decodeReturn,
  formatArgument,
  methodNameOf,
  shortAddress,
  toCallExpression,
  valueModifier,
} from "../components/explorer/TxDetail/callExpression";

describe("toCallTree", () => {
  it("marks the last child at every level", () => {
    //  a          depth 1 — the only root, so it is last
    //  ├─ b       depth 2 — d follows it at the same depth
    //  │  └─ c    depth 3
    //  └─ d       depth 2
    const tree = toCallTree([
      { id: "a", depth: 1 },
      { id: "b", depth: 2 },
      { id: "c", depth: 3 },
      { id: "d", depth: 2 },
    ]);
    expect(tree.map((n) => n.isLast)).toEqual([true, false, true, true]);
    expect(tree.map((n) => n.hasChildren)).toEqual([true, true, false, false]);
  });

  it("runs a guide line past a row whose ancestor has more siblings", () => {
    const tree = toCallTree([
      { depth: 1 },
      { depth: 2 },
      { depth: 3 },
      { depth: 2 },
      { depth: 1 },
    ]);
    // Row 3 sits at depth 3 under a depth-2 parent that has a later sibling,
    // so that one guide line continues.
    expect(tree[2]!.guides).toEqual([true]);
  });

  it("draws no guide for depth 1, which has no connector of its own", () => {
    // A direct call renders nothing, so a `│` in its column would hang off
    // nothing — and it made two depth-3 rows look differently indented.
    const tree = toCallTree([{ depth: 1 }, { depth: 2 }, { depth: 1 }]);
    expect(tree[1]!.guides).toEqual([]);
  });

  it("renders a pre-depth cached response as one flat level", () => {
    const tree = toCallTree([{}, {}, {}]);
    expect(tree.map((n) => n.depth)).toEqual([1, 1, 1]);
    expect(tree.map((n) => n.isLast)).toEqual([false, false, true]);
  });

  it("never reports a depth below 1", () => {
    expect(toCallTree([{ depth: 0 }, { depth: -3 }]).map((n) => n.depth)).toEqual([
      1, 1,
    ]);
  });
});

describe("signature parsing", () => {
  it("splits a text signature into a name and its argument types", () => {
    expect(methodNameOf("transfer(address,uint256)")).toBe("transfer");
    expect(argumentTypes("transfer(address,uint256)")).toBe("address,uint256");
    expect(argumentTypes("totalSupply()")).toBeNull();
    expect(argumentTypes("not a signature")).toBeNull();
  });
});

describe("decodeArguments", () => {
  const HOLDER = "0xcea0bb7d1692c25f5f9b0d3b7d1c8b2a0e5b7d1c";

  it("decodes real balanceOf calldata", () => {
    const input = "0x70a08231" + HOLDER.slice(2).padStart(64, "0");
    // viem checksums the address it decodes, which is the form to display.
    expect(decodeArguments("balanceOf(address)", input)).toEqual([
      shortAddress(getAddress(HOLDER)),
    ]);
  });

  it("returns an empty list for a no-argument signature", () => {
    expect(decodeArguments("getReserves()", "0x0902f1ac")).toEqual([]);
  });

  it("returns null rather than a wrong decode when calldata does not match", () => {
    expect(decodeArguments("transfer(address,uint256)", "0xa9059cbb00")).toBeNull();
    expect(decodeArguments("balanceOf(address)", "0x70a08231")).toBeNull();
  });
});

describe("decodeReturn", () => {
  const TRUE = "0x" + "0".repeat(63) + "1";

  it("reads a bool return for a signature ERC-20 fixes", () => {
    expect(decodeReturn("transfer(address,uint256)", TRUE)).toBe("true");
    expect(decodeReturn("approve(address,uint256)", TRUE)).toBe("true");
  });

  it("reads a uint return as a grouped number", () => {
    const word = "0x" + (12345n).toString(16).padStart(64, "0");
    expect(decodeReturn("balanceOf(address)", word)).toBe("12,345");
  });

  it("claims nothing for a signature no standard fixes", () => {
    // 4byte stores argument types only, so a return type is not derivable in
    // general — this must stay silent rather than guess.
    expect(decodeReturn("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", TRUE)).toBeNull();
    expect(decodeReturn(null, TRUE)).toBeNull();
    expect(decodeReturn("transfer(address,uint256)", "0x")).toBeNull();
    expect(decodeReturn("transfer(address,uint256)", undefined)).toBeNull();
  });
});

describe("valueModifier", () => {
  it("is absent for a call that sends nothing", () => {
    expect(valueModifier("0", "0", "PLS")).toBeNull();
  });

  it("renders whole and fractional amounts without trailing zeros", () => {
    expect(valueModifier("1000000000000000000", "1.0", "PLS")).toBe(
      "{value: 1 PLS}",
    );
    expect(valueModifier("1500000000000000000", "1.5", "ETH")).toBe(
      "{value: 1.5 ETH}",
    );
  });

  it("falls back to the API's scaled string on an unparseable raw value", () => {
    expect(valueModifier("not-a-number", "2.5", "PLS")).toBe("{value: 2.5 PLS}");
  });
});

describe("formatArgument", () => {
  it("shortens addresses and long hex, groups numbers, names bools", () => {
    const addr = "0x" + "ab".repeat(20);
    expect(formatArgument(addr)).toBe(shortAddress(addr));
    expect(formatArgument(1234567n)).toBe("1,234,567");
    expect(formatArgument(true)).toBe("true");
    expect(formatArgument("0x" + "cd".repeat(40))).toMatch(/^0x[0-9a-f]{8}…$/);
  });

  it("shows only the ends of a long array, which is usually a swap route", () => {
    const a = "0x" + "11".repeat(20);
    const b = "0x" + "22".repeat(20);
    const c = "0x" + "33".repeat(20);
    expect(formatArgument([a, b, c])).toBe(
      `[${shortAddress(a)}…${shortAddress(c)}]`,
    );
    expect(formatArgument([a, b])).toBe(
      `[${shortAddress(a)}, ${shortAddress(b)}]`,
    );
  });
});

describe("calldataBytes", () => {
  it("counts bytes, selector included", () => {
    expect(calldataBytes("0x")).toBe(0);
    expect(calldataBytes("0x70a08231")).toBe(4);
    expect(calldataBytes("0x70a08231" + "00".repeat(32))).toBe(36);
  });
});

describe("toCallExpression", () => {
  const base = {
    to: "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
    value: "0",
    valuePLS: "0",
    type: "CALL",
    input: "0x",
    isError: "0",
    errCode: "",
  };

  it("names a plain value transfer 'send', not an unknown selector", () => {
    const expr = toCallExpression(
      { ...base, value: "1000000000000000000", valuePLS: "1.0" },
      "PLS",
    );
    expect(expr.method).toBe("send");
    expect(expr.valueModifier).toBe("{value: 1 PLS}");
  });

  it("falls back to the raw selector when 4byte has no name", () => {
    const expr = toCallExpression(
      { ...base, input: "0xdeadbeef" + "00".repeat(32), methodId: "0xdeadbeef" },
      "PLS",
    );
    expect(expr.method).toBe("0xdeadbeef");
    expect(expr.args).toBeNull();
    expect(expr.calldataBytes).toBe(36);
  });

  it("marks a name the 4byte source is not sure of", () => {
    const settled = toCallExpression(
      {
        ...base,
        input: "0xa9059cbb",
        methodId: "0xa9059cbb",
        methodSignature: "transfer(address,uint256)",
        methodCandidates: 1,
      },
      "PLS",
    );
    expect(settled.methodIsGuess).toBe(false);

    const guess = toCallExpression(
      {
        ...base,
        input: "0xa9059cbb",
        methodId: "0xa9059cbb",
        methodSignature: "transfer(address,uint256)",
        methodCandidates: 4,
      },
      "PLS",
    );
    expect(guess.methodIsGuess).toBe(true);
  });

  it("reports a revert reason and keeps the rest of the line", () => {
    const expr = toCallExpression(
      {
        ...base,
        input: "0x23b872dd",
        methodId: "0x23b872dd",
        methodSignature: "transferFrom(address,address,uint256)",
        methodCandidates: 1,
        isError: "1",
        errCode: "execution reverted",
      },
      "PLS",
    );
    expect(expr.method).toBe("transferFrom");
    expect(expr.error).toBe("execution reverted");
  });

  it("says 'reverted' when the trace flags a failure with no reason", () => {
    const expr = toCallExpression({ ...base, isError: "1" }, "PLS");
    expect(expr.error).toBe("reverted");
  });
});
