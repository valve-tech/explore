import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getMergedActivity,
  type ActivityDeps,
} from "../../src/services/multichain/mergedActivity.js";
import type { ChainPresence } from "../../src/services/multichain/chainPresence.js";

const ADDR = "0x11490e0f8050fa8a3f40c5aa9bb20fb76b010b68";

function present(chainId: number): ChainPresence {
  return { chainId, balance: "1", nonce: 1, isContract: false };
}
function absent(chainId: number): ChainPresence {
  return { chainId, balance: "0", nonce: 0, isContract: false };
}
function errored(chainId: number): ChainPresence {
  return { chainId, balance: "0", nonce: 0, isContract: false, error: true };
}

function tx(chainId: number, ts: number, hash: string) {
  return { chainId, hash, timeStamp: String(ts) };
}

function deps(overrides: Partial<ActivityDeps> = {}): ActivityDeps {
  return {
    fetchForChain: async (chainId) =>
      chainId === 1
        ? [tx(1, 300, "0xa"), tx(1, 100, "0xc")]
        : [tx(369, 200, "0xb")],
    timeoutMs: 50,
    ...overrides,
  };
}

describe("getMergedActivity", () => {
  it("merges rows from every present chain, newest first", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps());
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb", "0xc"]);
  });

  it("skips chains with no presence entirely", async () => {
    const seen: number[] = [];
    await getMergedActivity(ADDR, [present(1), absent(369)], 10, deps({
      fetchForChain: async (chainId) => { seen.push(chainId); return []; },
    }));
    assert.deepEqual(seen, [1]);
  });

  it("skips errored chains but still reports them", async () => {
    const out = await getMergedActivity(ADDR, [present(1), errored(11155111)], 10, deps());
    assert.equal(out.perChain.find((p) => p.chainId === 11155111)!.error, true);
    assert.equal(out.perChain.find((p) => p.chainId === 11155111)!.returned, 0);
  });

  it("truncates to the limit after merging, not before", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 2, deps());
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb"]);
  });

  it("reports each chain's contribution", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps());
    assert.deepEqual(
      out.perChain.map((p) => [p.chainId, p.returned]),
      [[1, 2], [369, 1]],
    );
  });

  it("marks a fetch failure as an errored chain, not an empty one", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps({
      fetchForChain: async (chainId) => {
        if (chainId === 369) throw new Error("archive down");
        return [tx(1, 300, "0xa")];
      },
    }));
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa"]);
    assert.equal(out.perChain.find((p) => p.chainId === 369)!.error, true);
  });

  it("returns empty rows and an empty perChain for an address with no presence", async () => {
    const out = await getMergedActivity(ADDR, [absent(1), absent(369)], 10, deps());
    assert.deepEqual(out.rows, []);
    assert.deepEqual(out.perChain, []);
  });

  it("orders ties by chain id so the merge is reproducible", async () => {
    const out = await getMergedActivity(ADDR, [present(1), present(369)], 10, deps({
      fetchForChain: async (chainId) => [tx(chainId, 500, chainId === 1 ? "0xa" : "0xb")],
    }));
    assert.deepEqual(out.rows.map((r) => r.hash), ["0xa", "0xb"]);
  });
});
