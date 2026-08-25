/**
 * Wire types for the fork-based simulator. Returned directly from the
 * `/api/simulate/fork` and `/api/simulate/from-hash` routes, so any change
 * here is client-visible.
 */

export interface ForkSimulationRequest {
  from: string;
  to: string;
  value?: string;
  data?: string;
  blockNumber?: number;
  gasLimit?: number;
}

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

export interface SimulationLog {
  address: string;
  topics: string[];
  data: string;
  decoded?: unknown;
}

export interface ForkSimulationResult {
  success: boolean;
  returnData: string;
  gasUsed: string;
  revertReason?: string;
  stateDiff: StateDiff;
  /**
   * False when the "before" reading could not be taken, so an empty
   * `stateDiff` means "unknown" rather than "nothing changed".
   */
  stateDiffAvailable?: boolean;
  logs: SimulationLog[];
  decodedInput?: unknown;
  blockNumber: number;
  txHash?: string;
  contractAddress?: string;
}
