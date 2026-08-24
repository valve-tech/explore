import { mainnet, pulsechain, pulsechainV4, sepolia } from "viem/chains";
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
 * The valve chain set — chains 1 (Ethereum), 369 (PulseChain), 943 (PulseChain
 * Testnet v4), 11155111 (Sepolia). Used when no `CHAINS_JSON` /
 * `CHAINS_CONFIG_PATH` is provided, so the hosted explorer's behavior is
 * unchanged. Kept in step with the gateway's own `config/chains.json` in the
 * valve monorepo — that file is what decides which chains rpc.valve.city
 * actually serves, and a chain registered here but absent there fails at
 * `getRpcClient` rather than silently returning another chain's data.
 *
 * Per-chain endpoints stay env-overridable (`ETH_RPC_URL`, `PULSECHAIN_RPC_URL`,
 * `PULSECHAIN_V4_RPC_URL`, `SEPOLIA_RPC_URL`, `DEBUG_RPC_URL`,
 * `BLOCKSCOUT_API_URL`) so even the default set can point at a self-hoster's own
 * nodes without a chains config. Unset sibling chains reuse the
 * `PULSECHAIN_RPC_URL` key via `valveRpcUrl`.
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
    caip2: { namespace: "eip155", reference: "1" },
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
    caip2: { namespace: "eip155", reference: "369" },
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
    caip2: { namespace: "eip155", reference: "943" },
    explorerSlug: "pulsechain-testnet",
    defaultBlockTimeSeconds: 10,
    testnet: true,
  },
  11155111: {
    chainId: 11155111,
    name: "Sepolia",
    shortName: "sep",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    // TrueBlocks' canonical slug for Sepolia. NOT confirmed against the valve
    // chifra daemon — `chifra.valve.city/status?chains=true` currently 403s and
    // its own meta reports `chain: mainnet` — so treat the appearances/transfers
    // routes as unproven on this chain. They degrade per-request the same way
    // any chain the daemon doesn't index does; they do not affect the trace,
    // explorer or debugger paths.
    chifraChain: "sepolia",
    rpcUrl: process.env.SEPOLIA_RPC_URL || valveRpcUrl(11155111),
    // No `rethSnapshotUrl` / `substreamsEndpoint`: neither
    // evm11155111-snapshot-reth.valve.city nor
    // evm-11155111-substreams.valve.city resolves in DNS. Naming an endpoint
    // that doesn't exist buys a timeout instead of a clean "not available".
    holdingsGraphqlUrl: holdingsGqlUrl(11155111),
    blockscoutBase:
      process.env.SEPOLIA_BLOCKSCOUT_URL ||
      "https://eth-sepolia.blockscout.com/api",
    sourcifyEnabled: true,
    burnsBaseFee: true,
    viemChain: sepolia,
    caip2: { namespace: "eip155", reference: "11155111" },
    explorerSlug: "sepolia",
    defaultBlockTimeSeconds: 12,
    testnet: true,
  },
};
