import { apiUrl } from "../lib/apiBase";
import { DEFAULT_CHAIN_ID } from "../lib/chains";
import { scoped } from "./chainScope";
import type {
  SimulationRequest,
  SimulationResult,
  BundleSimulationRequest,
  BundleSimulationResult,
  StateOverride,
} from "../types";

const API_BASE = apiUrl("/api");

function buildStateOverridesPayload(
  overrides: StateOverride[],
): Record<string, Record<string, unknown>> | undefined {
  if (overrides.length === 0) return undefined;

  const result: Record<string, Record<string, unknown>> = {};
  for (const o of overrides) {
    if (!o.address) continue;
    const entry: Record<string, unknown> = {};
    if (o.balance) entry.balance = o.balance;
    if (o.nonce) entry.nonce = o.nonce;
    if (o.code) entry.code = o.code;
    if (o.storage && Object.keys(o.storage).length > 0) {
      entry.stateDiff = o.storage;
    }
    if (Object.keys(entry).length > 0) {
      result[o.address] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Simulate a single transaction on `chainId` (threaded as the `?chainid=N`
 * dispatcher param; the default chain omits it, matching the backend's 369
 * fallback).
 */
export async function simulateTransaction(
  req: SimulationRequest,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<SimulationResult> {
  const payload: Record<string, unknown> = {
    from: req.from,
    to: req.to,
  };

  if (req.value) payload.value = req.value;
  if (req.data) payload.data = req.data;
  if (req.gasLimit) payload.gasLimit = req.gasLimit;
  if (req.blockNumber && req.blockNumber !== "latest") {
    payload.blockNumber = req.blockNumber;
  }
  if (req.stateOverrides) {
    payload.stateOverrides = buildStateOverridesPayload(req.stateOverrides);
  }
  if (req.abi) payload.abi = req.abi;

  const response = await fetch(scoped(`${API_BASE}/simulate`, chainId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorText) as { error?: string };
      message = parsed.error ?? errorText;
    } catch {
      message = errorText;
    }
    throw new Error(`Simulation failed: ${message}`);
  }

  // API envelope is `{ ok: true, result: {...} }` (lib/respond.ts → routes/
  // simulate.ts). Unwrap `.result` — returning the raw envelope leaves
  // `success`/`gasEstimate` undefined on the consumer and crashes the panel.
  const json = (await response.json()) as { result: SimulationResult };
  return json.result;
}

/** Simulate an ordered bundle on `chainId` (same scoping as simulateTransaction). */
export async function simulateBundle(
  req: BundleSimulationRequest,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<BundleSimulationResult> {
  const payload = {
    transactions: req.transactions.map((tx) => {
      const entry: Record<string, unknown> = {
        from: tx.from,
        to: tx.to,
      };
      if (tx.value) entry.value = tx.value;
      if (tx.data) entry.data = tx.data;
      if (tx.gasLimit) entry.gasLimit = tx.gasLimit;
      if (tx.blockNumber && tx.blockNumber !== "latest") {
        entry.blockNumber = tx.blockNumber;
      }
      if (tx.stateOverrides) {
        entry.stateOverrides = buildStateOverridesPayload(tx.stateOverrides);
      }
      if (tx.abi) entry.abi = tx.abi;
      return entry;
    }),
  };

  const response = await fetch(scoped(`${API_BASE}/simulate-bundle`, chainId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorText) as { error?: string };
      message = parsed.error ?? errorText;
    } catch {
      message = errorText;
    }
    throw new Error(`Bundle simulation failed: ${message}`);
  }

  return (await response.json()) as BundleSimulationResult;
}

// Fork simulation types
export interface BalanceChange {
  address: string;
  before: string;
  after: string;
  delta: string;
}

export interface StorageChange {
  address: string;
  contractName?: string;
  slot: string;
  before: string;
  after: string;
  decodedName?: string;
}

export interface NonceChange {
  address: string;
  before: number;
  after: number;
}

export interface StateDiff {
  balanceChanges: BalanceChange[];
  storageChanges: StorageChange[];
  nonceChanges: NonceChange[];
}

export interface ForkSimulationResult {
  success: boolean;
  returnData: string;
  gasUsed: string;
  revertReason?: string;
  stateDiff: StateDiff;
  /**
   * False when the fork could not report the state before the call, so an
   * empty `stateDiff` means "unknown" rather than "nothing changed".
   * Optional: a response from before this field existed omits it, and an
   * absent flag counts as available.
   */
  stateDiffAvailable?: boolean;
  logs: Array<{ address: string; topics: string[]; data: string; decoded?: unknown }>;
  decodedInput?: unknown;
  blockNumber: number;
  txHash?: string;
  contractAddress?: string;
}

export interface ForkSimulationResponse {
  ok: boolean;
  result?: ForkSimulationResult;
  error?: string;
}

export async function forkSimulate(params: {
  from: string;
  to: string;
  value?: string;
  data?: string;
  blockNumber?: number;
  gasLimit?: number;
}): Promise<ForkSimulationResponse> {
  const res = await fetch(apiUrl("/api/simulate/fork"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return (await res.json()) as ForkSimulationResponse;
}

export async function simulateFromHash(txHash: string): Promise<ForkSimulationResponse> {
  const res = await fetch(apiUrl("/api/simulate/from-hash"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash }),
  });
  return (await res.json()) as ForkSimulationResponse;
}
