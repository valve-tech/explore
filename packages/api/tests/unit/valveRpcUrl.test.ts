import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { valveRpcUrl } from "../../src/services/chains/defaults.js";

/**
 * valveRpcUrl reuses the PULSECHAIN_RPC_URL key for sibling valve chains, so one
 * env var covers 1 / 369 / 943 and Ethereum/Testnet don't fall back to the
 * rate-limited vk_demo key (the prod 429 on /network-health?chainid=1).
 */
describe("valveRpcUrl — sibling-chain key reuse", () => {
  const orig = process.env.PULSECHAIN_RPC_URL;
  afterEach(() => {
    if (orig === undefined) delete process.env.PULSECHAIN_RPC_URL;
    else process.env.PULSECHAIN_RPC_URL = orig;
  });

  it("reuses the key for siblings (rpc.valve.city/…/evm/369 shape)", () => {
    process.env.PULSECHAIN_RPC_URL = "https://rpc.valve.city/v1/SECRET/evm/369";
    assert.equal(valveRpcUrl(1), "https://rpc.valve.city/v1/SECRET/evm/1");
    assert.equal(valveRpcUrl(943), "https://rpc.valve.city/v1/SECRET/evm/943");
  });

  it("reuses the key for siblings (one.valve.city/rpc/…/evm/369 shape)", () => {
    process.env.PULSECHAIN_RPC_URL =
      "https://one.valve.city/rpc/SECRET/evm/369";
    assert.equal(valveRpcUrl(1), "https://one.valve.city/rpc/SECRET/evm/1");
    assert.equal(valveRpcUrl(943), "https://one.valve.city/rpc/SECRET/evm/943");
  });

  it("swaps the host segment too (evm-369-rpc shape)", () => {
    process.env.PULSECHAIN_RPC_URL =
      "https://evm-369-rpc.valve.city/v1/SECRET/evm/369";
    assert.equal(valveRpcUrl(1), "https://evm-1-rpc.valve.city/v1/SECRET/evm/1");
  });

  it("returns '' when PULSECHAIN_RPC_URL is unset (no demo fallback)", () => {
    delete process.env.PULSECHAIN_RPC_URL;
    assert.equal(valveRpcUrl(1), "");
  });

  it("returns '' for a non-valve PULSECHAIN_RPC_URL (no demo fallback)", () => {
    process.env.PULSECHAIN_RPC_URL = "https://my-own-node.example/rpc";
    assert.equal(valveRpcUrl(1), "");
  });
});
