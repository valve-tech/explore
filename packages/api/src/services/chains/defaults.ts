import { mainnet, pulsechain, pulsechainV4 } from "viem/chains";
import { type ChainConfig } from "./types.js";

/**
 * The valve launch set — chains 1 (Ethereum), 369 (PulseChain), 943
 * (PulseChain Testnet v4). Used when no `CHAINS_JSON` / `CHAINS_CONFIG_PATH`
 * is provided, so the hosted explorer's behavior is unchanged.
 *
 * Per-chain endpoints stay env-overridable (`ETH_RPC_URL`, `PULSECHAIN_RPC_URL`,
 * `PULSECHAIN_V4_RPC_URL`, `DEBUG_RPC_URL`, `BLOCKSCOUT_API_URL`) so even the
 * default set can point at a self-hoster's own nodes without a chains config.
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
    // Default to valve's own RPC with the public, per-IP-rate-limited vk_demo
    // key (right for basic/one-off reads); production overrides via env with
    // the valve.city unlimited key.
    rpcUrl: process.env.ETH_RPC_URL || "https://evm-1-rpc.valve.city/v1/vk_demo/evm/1",
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
    rpcUrl: process.env.PULSECHAIN_RPC_URL || "https://evm-369-rpc.valve.city/v1/vk_demo/evm/369",
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
    rpcUrl: process.env.PULSECHAIN_V4_RPC_URL || "https://evm-943-rpc.valve.city/v1/vk_demo/evm/943",
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
