import { describe, it, expect } from "vitest";
import { parseInput, KIND_LABELS } from "../components/AppShell/parseInput";
import { buildResults } from "../components/AppShell/buildResults";
import type { RecentEntity } from "../lib/recentEntities";

/**
 * Supplemental coverage for the command-palette parse + result builder. The
 * existing buildResults.test.ts covers the "Pages" tab; this file drives the
 * uncovered branches: every parse kind (tx/address/selector/block/unknown),
 * the recent / contracts tabs, the empty-query "all" path, and the jump-entity
 * mapping.
 *
 * Real on-chain anchors (PulseChain 369, https://scan.pulsechain.com):
 *   WPLS token:  0xA1077a294dDE1B09bB078844df40758a5D0f9a27
 *   a 66-char tx hash + a block number stand in for the other kinds.
 */
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";
const TX_HASH =
  "0x" + "ab".repeat(32); // 66 chars total — a valid tx-hash shape
const SELECTOR = "0xa9059cbb"; // transfer(address,uint256)
const BLOCK = "19000000";

describe("parseInput — all entity kinds", () => {
  it("recognizes a tx hash and offers Debugger + Explorer actions", () => {
    const p = parseInput(TX_HASH);
    expect(p.kind).toBe("tx");
    if (p.kind !== "tx") throw new Error("narrow");
    expect(p.actions.map((a) => a.to)).toEqual([
      `/debugger/${TX_HASH}`,
      `/tx/${TX_HASH}`,
    ]);
  });

  it("recognizes an address (WPLS) and offers Explorer + storage actions", () => {
    const p = parseInput(WPLS);
    expect(p.kind).toBe("address");
    if (p.kind !== "address") throw new Error("narrow");
    expect(p.actions.map((a) => a.to)).toEqual([
      `/address/${WPLS}`,
      `/storage?address=${WPLS}`,
    ]);
  });

  it("recognizes a 4byte selector", () => {
    const p = parseInput(SELECTOR);
    expect(p.kind).toBe("selector");
    if (p.kind !== "selector") throw new Error("narrow");
    expect(p.actions[0]!.to).toBe(`/explorer?selector=${SELECTOR}`);
  });

  it("recognizes a bare block number", () => {
    const p = parseInput(BLOCK);
    expect(p.kind).toBe("block");
    if (p.kind !== "block") throw new Error("narrow");
    expect(p.actions[0]!.to).toBe(`/block/${BLOCK}`);
  });

  it("returns unknown for empty / unrecognized input", () => {
    expect(parseInput("").kind).toBe("unknown");
    expect(parseInput("   ").kind).toBe("unknown");
    expect(parseInput("hello world").kind).toBe("unknown");
  });

  it("exposes a human label for every concrete kind", () => {
    expect(KIND_LABELS.tx).toMatch(/transaction/i);
    expect(KIND_LABELS.address).toMatch(/address/i);
    expect(KIND_LABELS.block).toMatch(/block/i);
    expect(KIND_LABELS.selector).toMatch(/selector/i);
  });
});

function entity(over: Partial<RecentEntity>): RecentEntity {
  return {
    kind: "address",
    value: WPLS,
    pinned: false,
    visits: 1,
    lastSeen: Date.now(),
    ...over,
  };
}

describe("buildResults — tabs and jump entities", () => {
  const recents: RecentEntity[] = [
    entity({ kind: "tx", value: TX_HASH, status: "success", label: "My swap" }),
    entity({ kind: "address", value: WPLS }),
    entity({ kind: "contract", value: WPLS, label: "WPLS" }),
    entity({ kind: "block", value: BLOCK }),
  ];

  it("recent tab returns non-contract recents then contracts", () => {
    const rows = buildResults("", parseInput(""), recents, "recent");
    const groups = rows.map((r) => r.group);
    // Recent group items precede Contracts.
    expect(groups).toContain("Recent");
    expect(groups).toContain("Contracts");
    expect(groups.indexOf("Recent")).toBeLessThan(groups.indexOf("Contracts"));
  });

  it("contracts tab returns only verified-contract recents", () => {
    const rows = buildResults("", parseInput(""), recents, "contracts");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.group).toBe("Contracts");
    expect(rows[0]!.label).toBe("WPLS");
    // Contract recents file into a workspace as kind:"address".
    expect(rows[0]!.entity).toEqual({ kind: "address", value: WPLS });
  });

  it("all tab with an empty query leads with recents (no page noise)", () => {
    const rows = buildResults("", parseInput(""), recents, "all");
    expect(rows.every((r) => r.group !== "Pages")).toBe(true);
    expect(rows.some((r) => r.group === "Pages")).toBe(false);
  });

  it("all tab with a tx query leads with the 'Jump to' actions carrying the entity", () => {
    const rows = buildResults(TX_HASH, parseInput(TX_HASH), recents, "all");
    const jump = rows.filter((r) => r.group === "Jump to");
    expect(jump.length).toBe(2);
    expect(jump[0]!.entity).toEqual({ kind: "tx", value: TX_HASH });
  });

  it("a selector query produces a jump row with NO fileable entity", () => {
    const rows = buildResults(SELECTOR, parseInput(SELECTOR), [], "all");
    const jump = rows.filter((r) => r.group === "Jump to");
    expect(jump.length).toBe(1);
    expect(jump[0]!.entity).toBeUndefined();
  });

  it("a labelled recent uses the truncated value as its detail", () => {
    const labelled = [entity({ kind: "address", value: WPLS, label: "WPLS" })];
    const rows = buildResults("", parseInput(""), labelled, "recent");
    // detail = truncMid(value) → first 8 + … + last 6 of the address.
    expect(rows[0]!.detail).toBe(`${WPLS.slice(0, 8)}…${WPLS.slice(-6)}`);
  });

  it("a block recent (no label, non-0x value) keeps its value un-truncated", () => {
    const blocks = [entity({ kind: "block", value: BLOCK })];
    const rows = buildResults("", parseInput(""), blocks, "recent");
    // primaryLabel → `#<block>` for a non-0x value.
    expect(rows[0]!.label).toBe(`#${BLOCK}`);
    // detail falls through to the bare kind.
    expect(rows[0]!.detail).toBe("block");
  });

  it("a short 0x value (<=16 chars) is shown verbatim, not truncated", () => {
    const short = "0x1234"; // 0x-prefixed but short → truncMid returns as-is
    const rows = buildResults(
      "",
      parseInput(""),
      [entity({ kind: "address", value: short })],
      "recent",
    );
    expect(rows[0]!.label).toBe(short);
  });

  it("a tx recent without a label shows its status as the detail", () => {
    const txs = [entity({ kind: "tx", value: TX_HASH, status: "reverted" })];
    const rows = buildResults("", parseInput(""), txs, "recent");
    expect(rows[0]!.detail).toBe("reverted");
  });

  it("filters recents by query against label and value", () => {
    const rows = buildResults("my swap", parseInput("my swap"), recents, "recent");
    expect(rows.map((r) => r.label)).toContain("My swap");
    // The WPLS address (no matching label/value substring) is filtered out.
    expect(rows.some((r) => r.label === "WPLS")).toBe(false);
  });
});
