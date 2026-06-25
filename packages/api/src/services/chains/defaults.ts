import { mainnet, pulsechain, pulsechainV4 } from "viem/chains";
import { type ChainConfig } from "./types.js";

/**
 * Default RPC URL for a sibling valve chain, derived from `PULSECHAIN_RPC_URL`
 * when it's a valve endpoint carrying a key (shape `…/v1/<key>/evm/369` or the
 * newer `…/rpc/<key>/evm/369`): swap the chain id so the one prod key covers
 * every valve chain. Returns `""` when
 * it can't derive — there is deliberately NO demo-key fallback. A silent
 * `vk_demo` fallback is what let prod 429 on Ethereum unnoticed; instead an
 * unconfigured chain fails loudly at `getRpcClient`. An explicit per-chain env
 * var (`ETH_RPC_URL`, `PULSECHAIN_V4_RPC_URL`) still wins at the call site.
 */
export function valveRpcUrl(chainId: number): string {
  const pls = process.env.PULSECHAIN_RPC_URL;
  if (pls && /\/(?:v1|rpc)\/[^/]+\/evm\/369\/?$/.test(pls)) {
    return pls
      .replace(/evm-369-/g, `evm-${chainId}-`) // host segment, e.g. evm-369-rpc.…
      .replace(/\/evm\/369(\/?)$/, `/evm/${chainId}$1`); // trailing path /evm/369
  }
  return "";
}

/**
 * The valve launch set — chains 1 (Ethereum), 369 (PulseChain), 943
 * (PulseChain Testnet v4). Used when no `CHAINS_JSON` / `CHAINS_CONFIG_PATH`
 * is provided, so the hosted explorer's behavior is unchanged.
 *
 * Per-chain endpoints stay env-overridable (`ETH_RPC_URL`, `PULSECHAIN_RPC_URL`,
 * `PULSECHAIN_V4_RPC_URL`, `DEBUG_RPC_URL`, `BLOCKSCOUT_API_URL`) so even the
 * default set can point at a self-hoster's own nodes without a chains config.
 * Unset sibling chains reuse the `PULSECHAIN_RPC_URL` key via `valveRpcUrl`.
 *
 * `chifraChain` slugs are verified against `chifra.valve.city/status?chains=true`.
 */

/**
 * The holdings GraphQL gateway URL for a chain, from env. A per-chain override
 * (`HOLDINGS_GRAPHQL_URL_<chainId>`) wins, else a single gateway for all chains
 * (`HOLDINGS_GRAPHQL_URL`). Unset → `undefined` → holdings not indexed for the
 * chain (native-only). No baked default: we never guess a host, mirroring the
 * no-demo-key stance for RPC.
 */
export function holdingsGqlUrl(chainId: number): string | undefined {
  return (
    process.env[`HOLDINGS_GRAPHQL_URL_${chainId}`] ||
    process.env.HOLDINGS_GRAPHQL_URL ||
    undefined
  );
}

export const VALVE_DEFAULT_CHAINS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    shortName: "eth",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    chifraChain: "mainnet",
    // Explicit ETH_RPC_URL wins; otherwise reuse the PULSECHAIN_RPC_URL key
    // (valveRpcUrl). No key → "" → getRpcClient fails loudly (no demo fallback).
    rpcUrl: process.env.ETH_RPC_URL || valveRpcUrl(1),
    rethSnapshotUrl: "https://evm1-snapshot-reth.valve.city",
    substreamsEndpoint: "evm-1-substreams.valve.city",
    holdingsGraphqlUrl: holdingsGqlUrl(1),
    sourcifyEnabled: true,
    burnsBaseFee: true,
    viemChain: mainnet,
    explorerSlug: "ethereum",
    defaultBlockTimeSeconds: 12,
    testnet: false,
  },
  369: {
    chainId: 369,
    name: "PulseChain",
    shortName: "pls",
    nativeSymbol: "PLS",
    nativeDecimals: 18,
    chifraChain: "pulsechain",
    rpcUrl: process.env.PULSECHAIN_RPC_URL || valveRpcUrl(369),
    debugRpcUrl: process.env.DEBUG_RPC_URL || undefined,
    rethSnapshotUrl: "https://evm369-snapshot-reth.valve.city",
    substreamsEndpoint: "evm-369-substreams.valve.city",
    holdingsGraphqlUrl: holdingsGqlUrl(369),
    blockscoutBase:
      process.env.BLOCKSCOUT_API_URL || "https://api.scan.pulsechain.com/api",
    sourcifyEnabled: true,
    burnsBaseFee: true,
    viemChain: pulsechain,
    explorerSlug: "pulsechain",
    defaultBlockTimeSeconds: 10,
    testnet: false,
  },
  943: {
    chainId: 943,
    name: "PulseChain Testnet v4",
    shortName: "plsv4",
    nativeSymbol: "v4PLS",
    nativeDecimals: 18,
    chifraChain: "pulsechain-v4",
    rpcUrl: process.env.PULSECHAIN_V4_RPC_URL || valveRpcUrl(943),
    rethSnapshotUrl: "https://evm943-snapshot-reth.valve.city",
    substreamsEndpoint: "evm-943-substreams.valve.city",
    holdingsGraphqlUrl: holdingsGqlUrl(943),
    blockscoutBase:
      process.env.PULSECHAIN_V4_BLOCKSCOUT_URL ||
      "https://api.scan.v4.testnet.pulsechain.com/api",
    sourcifyEnabled: false,
    burnsBaseFee: true,
    viemChain: pulsechainV4,
    explorerSlug: "pulsechain-testnet",
    defaultBlockTimeSeconds: 10,
    testnet: true,
  },
};
