import { formatEther } from "viem";
import type {
  BalanceChange,
  NonceChange,
  StateDiff,
  StorageChange,
} from "./types.js";
import { forkRpc, getBalance, getNonce, getStorageAt } from "./forkRpc.js";

interface PrestateAccount {
  balance?: string;
  nonce?: number;
  code?: string;
  storage?: Record<string, string>;
}

type PrestateResult = Record<string, PrestateAccount>;

/**
 * Raised when the prestate tracer did not answer. `collectStateDiff` uses
 * the prestate as its "before" reading, so without it every account looks
 * unchanged — and an unchanged account is the one thing a simulated
 * transaction can never be.
 */
export class PrestateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrestateUnavailableError";
  }
}

/**
 * True when a prestate result means "the tracer did not answer", not "this
 * transaction touched nothing".
 *
 * The second reading is impossible, and that is what makes the empty object
 * decidable. A simulated transaction always spends gas from its sender, so
 * a working `prestateTracer` always reports at least that one account.
 * An empty map therefore only ever comes from a node that lacks the tracer
 * — which used to render every balance, nonce and storage slot as
 * unchanged, and the simulator's Diff tab printed "No state changes
 * detected."
 */
export function isPrestateUnavailable(prestate: PrestateResult): boolean {
  return Object.keys(prestate).length === 0;
}

/**
 * Ask anvil for the prestate (state BEFORE the tx executed) for every
 * account the tx touched. Anvil supports `prestateTracer` natively; a node
 * that lacks it answers with nothing, and that must not be mistaken for a
 * transaction that changed nothing.
 */
async function getPrestateTrace(
  rpcUrl: string,
  txHash: string,
): Promise<PrestateResult> {
  let result: unknown;
  try {
    result = await forkRpc(rpcUrl, "debug_traceTransaction", [
      txHash,
      { tracer: "prestateTracer" },
    ]);
  } catch (err) {
    throw new PrestateUnavailableError(
      `prestateTracer failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const prestate = (result ?? {}) as PrestateResult;
  if (isPrestateUnavailable(prestate)) {
    throw new PrestateUnavailableError(
      "prestateTracer returned no accounts — this node does not support it",
    );
  }
  return prestate;
}

/**
 * Walk the prestate output + a post-state probe to produce a structured
 * diff of balance / nonce / storage changes. The address set is the union
 * of (from, to, every account in the prestate) — covers transitively
 * touched contracts the caller didn't explicitly name.
 *
 * Throws `PrestateUnavailableError` rather than returning an empty diff when
 * there is no "before" reading to compare against. An empty diff is a claim
 * that nothing changed, and the caller must be able to tell that apart from
 * not knowing.
 */
export async function collectStateDiff(
  rpcUrl: string,
  txHash: string,
  from: string,
  to: string,
): Promise<StateDiff> {
  const balanceChanges: BalanceChange[] = [];
  const storageChanges: StorageChange[] = [];
  const nonceChanges: NonceChange[] = [];

  const prestate = await getPrestateTrace(rpcUrl, txHash);

  const addresses = new Set<string>();
  addresses.add(from.toLowerCase());
  if (to) addresses.add(to.toLowerCase());
  for (const addr of Object.keys(prestate)) {
    addresses.add(addr.toLowerCase());
  }

  for (const addr of addresses) {
    const postBalance = await getBalance(rpcUrl, addr);
    // If the account isn't in the prestate it didn't change — treat the
    // post-balance as both before and after.
    const preBalance = prestate[addr]?.balance
      ? BigInt(prestate[addr].balance)
      : postBalance;

    if (postBalance !== preBalance) {
      const delta = postBalance - preBalance;
      balanceChanges.push({
        address: addr,
        before: formatEther(preBalance),
        after: formatEther(postBalance),
        delta: `${delta >= 0n ? "+" : ""}${formatEther(delta)}`,
      });
    }

    const postNonce = await getNonce(rpcUrl, addr);
    const preNonce = prestate[addr]?.nonce ?? postNonce;
    if (postNonce !== preNonce) {
      nonceChanges.push({ address: addr, before: preNonce, after: postNonce });
    }

    const preStorage = prestate[addr]?.storage ?? {};
    for (const [slot, preValue] of Object.entries(preStorage)) {
      const postValue = await getStorageAt(rpcUrl, addr, slot);
      if (postValue.toLowerCase() !== preValue.toLowerCase()) {
        storageChanges.push({
          address: addr,
          slot,
          before: preValue,
          after: postValue,
        });
      }
    }
  }

  return { balanceChanges, storageChanges, nonceChanges };
}
