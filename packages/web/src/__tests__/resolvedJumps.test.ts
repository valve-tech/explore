import { describe, it, expect } from "vitest";
import { parseInput } from "../components/AppShell/parseInput";
import { resolvedActions, type Resolution } from "../components/AppShell/resolvedJumps";
import { buildResults } from "../components/AppShell/buildResults";
import { chainById, DEFAULT_CHAIN_ID } from "../lib/chains";

/**
 * The cross-chain jump builder: a pasted tx/address resolves across every
 * registered chain, so its palette actions target the chain(s) it lives on
 * (each carrying ?chainid=N + labelled), and degrade to the parser's bare
 * default-chain actions while resolving or when found nowhere.
 */

const TX = `0x${"a".repeat(64)}`;
const ADDR = `0x${"b".repeat(40)}`;

const done = (matches: Resolution["matches"]): Resolution => ({
  status: "done",
  matches,
});

/** Narrow the parseInput union — the fixtures are always recognized entities. */
function actionsOf(p: ReturnType<typeof parseInput>) {
  if (p.kind === "unknown") throw new Error("fixture did not classify");
  return p.actions;
}

describe("resolvedActions", () => {
  it("falls back to bare default-chain actions while resolving", () => {
    const parsed = parseInput(TX);
    const loading: Resolution = { status: "loading", matches: [] };
    expect(resolvedActions(parsed, loading)).toEqual(actionsOf(parsed));
    // and with no resolution at all
    expect(resolvedActions(parsed)).toEqual(actionsOf(parsed));
  });

  it("falls back to bare actions when found on no chain", () => {
    const parsed = parseInput(TX);
    expect(resolvedActions(parsed, done([]))).toEqual(actionsOf(parsed));
  });

  it("targets a non-default chain with ?chainid and a chain label", () => {
    const parsed = parseInput(TX); // kind: tx
    const out = resolvedActions(parsed, done([{ chainId: 1 }]));
    const name = chainById(1)!.name;
    expect(out).toHaveLength(actionsOf(parsed).length);
    for (const a of out) {
      expect(a.to).toContain("chainid=1");
      expect(a.detail.startsWith(`on ${name} — `)).toBe(true);
    }
  });

  it("omits chainid for the default chain (byte-identical to single-chain era)", () => {
    const parsed = parseInput(TX);
    const out = resolvedActions(parsed, done([{ chainId: DEFAULT_CHAIN_ID }]));
    for (const a of out) expect(a.to).not.toContain("chainid=");
  });

  it("uses & when the base route already has a query string", () => {
    const parsed = parseInput(ADDR); // includes /storage?address=…
    const out = resolvedActions(parsed, done([{ chainId: 1 }]));
    const storage = out.find((a) => a.to.startsWith("/storage"));
    expect(storage?.to).toContain("&chainid=1");
  });

  it("expands to one action set per matched chain for a multi-chain address", () => {
    const parsed = parseInput(ADDR);
    const out = resolvedActions(
      parsed,
      done([{ chainId: 1 }, { chainId: 943 }]),
    );
    expect(out).toHaveLength(actionsOf(parsed).length * 2);
    expect(out.some((a) => a.to.includes("chainid=1"))).toBe(true);
    expect(out.some((a) => a.to.includes("chainid=943"))).toBe(true);
  });

  it("leaves block/selector actions untouched (not chain-located)", () => {
    const block = parseInput("12345");
    expect(resolvedActions(block, done([{ chainId: 1 }]))).toEqual(actionsOf(block));
    const selector = parseInput("0xdeadbeef");
    expect(resolvedActions(selector, done([{ chainId: 1 }]))).toEqual(
      actionsOf(selector),
    );
  });
});

describe("buildResults with resolution", () => {
  it("emits per-chain Jump rows for a resolved tx", () => {
    const parsed = parseInput(TX);
    const results = buildResults(TX, parsed, [], "all", done([{ chainId: 1 }]));
    const jumps = results.filter((r) => r.group === "Jump to");
    expect(jumps.length).toBe(actionsOf(parsed).length);
    for (const j of jumps) expect(j.to).toContain("chainid=1");
  });
});
