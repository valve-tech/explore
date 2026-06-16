import { mainnet, pulsechain, pulsechainV4 } from "viem/chains";
import { type ChainConfig } from "./types.js";

/**
 * Default RPC URL for a valve chain. If `PULSECHAIN_RPC_URL` is a valve endpoint
 * carrying a key (the prod unlimited key, shape `…/v1/<key>/evm/369`), reuse that
 * same key for sibling chains by swapping the chain id — so one env var covers
 * every valve chain and Ethereum/Testnet don't silently fall back to the
 * per-IP-rate-limited `vk_demo` key. Otherwise (unset, or a self-hoster's own
 * non-valve node), fall back to `vk_demo`. An explicit per-chain env var
 * (`ETH_RPC_URL`, `PULSECHAIN_V4_RPC_URL`) still wins at the call site below.
 */
export function valveRpcUrl(chainId: number): string {
  const pls = process.env.PULSECHAIN_RPC_URL;
  if (pls && /\/v1\/[^/]+\/evm\/369\/?$/.test(pls)) {
    return pls
      .replace(/evm-369-/g, `evm-${chainId}-`) // host segment, e.g. evm-369-rpc.…
      .replace(/\/evm\/369(\/?)$/, `/evm/${chainId}$1`); // trailing path /evm/369
  }
  return `https://evm-${chainId}-rpc.valve.city/v1/vk_demo/evm/${chainId}`;
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
export const VALVE_DEFAULT_CHAINS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    shortName: "eth",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    chifraChain: "mainnet",
    // Explicit ETH_RPC_URL wins; otherwise reuse the PULSECHAIN_RPC_URL key
    // (valveRpcUrl), falling back to the per-IP-rate-limited vk_demo key.
    rpcUrl: process.env.ETH_RPC_URL || valveRpcUrl(1),
    rethSnapshotUrl: "https://evm1-snapshot-reth.valve.city",
    substreamsEndpoint: "evm-1-substreams.valve.city",
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
