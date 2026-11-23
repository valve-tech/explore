import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLayoutCache } from "../../src/services/solcCompiler/layoutCache.js";
import type { CompilationResult } from "../../src/services/solcCompiler/types.js";

// PulseXPair on PulseChain, a contract whose layout the debugger reads.
const PAIR = "0xE0f07d8020aE05dECC4fcc10396B434Df30fe5B3";
const result = { contractName: "PulseXPair" } as CompilationResult;

describe("storage layout cache", () => {
  it("compiles once for concurrent and repeated requests on one chain", async () => {
    let calls = 0;
    const get = createLayoutCache(async () => { calls++; return result; }, () => 369);
    await Promise.all([get(PAIR), get(PAIR.toLowerCase()), get(PAIR)]);
    await get(PAIR);
    assert.equal(calls, 1);
  });

  it("keys by chain, so another chain compiles again", async () => {
    let calls = 0;
    let chain = 369;
    const get = createLayoutCache(async () => { calls++; return result; }, () => chain);
    await get(PAIR);
    chain = 1;
    await get(PAIR);
    assert.equal(calls, 2);
  });

  it("keeps a null result for ten minutes, then tries again", async () => {
    let calls = 0;
    let t = 0;
    const get = createLayoutCache(async () => { calls++; return null; }, () => 369, () => t);
    await get(PAIR);
    t = 9 * 60_000;
    await get(PAIR);
    assert.equal(calls, 1);
    t = 11 * 60_000;
    await get(PAIR);
    assert.equal(calls, 2);
  });

  it("forgets a failed compile, so the next request tries again", async () => {
    let calls = 0;
    const get = createLayoutCache(async () => { calls++; throw new Error("solc crashed"); }, () => 369);
    await assert.rejects(get(PAIR));
    await new Promise((r) => setImmediate(r));
    await assert.rejects(get(PAIR));
    assert.equal(calls, 2);
  });
});
