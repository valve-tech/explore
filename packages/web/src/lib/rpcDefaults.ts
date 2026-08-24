import { getRpcOverride } from "./rpcEndpoint";

/**
 * Where the BROWSER's own chain calls go when the user has not chosen.
 *
 * Distinct from two neighbours it is easy to confuse:
 *   - `rpcEndpoint.ts` stores the user's per-chain override. This module
 *     decides what happens when they haven't set one.
 *   - the API's `services/chains` config is the BACKEND's upstream. That URL
 *     carries a credit-exempt key and must never reach the browser.
 *
 * Before this existed, wagmi was configured with a bare `http()` per chain,
 * which silently falls back to whatever endpoint viem compiles into its chain
 * definition — `https://eth.merkle.io` for Ethereum. That is a third party
 * nobody chose, on a page that tells the user their browser makes no direct
 * node calls. Sepolia had no transport at all.
 *
 * DELIBERATELY free of any `@valve-tech/rpc-collector` import. `wagmi.ts`
 * depends on this module, so anything imported here lands in the app's core
 * chunk — and the collector carries a ~272 KB vendored chainlist dataset.
 * The suggestion list lives in `rpcSuggestions.ts`, which only the settings
 * UI pulls in.
 */

/**
 * Valve's own public endpoints. `vk_demo` is the PUBLIC demo key — it is
 * already published in the DefiLlama chainlist dataset and in
 * valve-tech/chainlist, so it is not a secret. It is a different key from the
 * backend's, which is credit-exempt with `debug_`/`trace_` open and stays
 * server-side.
 *
 * These are the default for two reasons:
 *   - they are ARCHIVE. Verified by asking each for state at block 1
 *     (`eth_getBalance` at `0x1`); all four answered.
 *   - they are ours, so a default page load contacts no third party.
 *
 * The chainlist dataset has no archive field, so a static filter cannot
 * express the first point — `rpcSuggestions.ts` can prove it per endpoint at
 * runtime, but only when the user asks.
 */
export const VALVE_PUBLIC_RPC: Readonly<Record<number, string>> = {
  1: "https://one.valve.city/rpc/vk_demo/evm/1",
  369: "https://one.valve.city/rpc/vk_demo/evm/369",
  943: "https://one.valve.city/rpc/vk_demo/evm/943",
  11155111: "https://one.valve.city/rpc/vk_demo/evm/11155111",
};

/** Where this browser's calls for `chainId` actually go right now. */
export function effectiveRpcUrl(chainId: number): string | undefined {
  return getRpcOverride(chainId) ?? VALVE_PUBLIC_RPC[chainId];
}

/** True when the effective endpoint is the default rather than a user's. */
export function isUsingDefaultRpc(chainId: number): boolean {
  return getRpcOverride(chainId) === null;
}
