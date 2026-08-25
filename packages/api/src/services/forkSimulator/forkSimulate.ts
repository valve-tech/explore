import type { Hex } from "viem";
import { forkManager, type Fork } from "../forkManager.js";
import { fetchAbi, decodeInput } from "../decoder.js";
import { ApiError } from "../../lib/respond.js";
import type {
  ForkSimulationRequest,
  ForkSimulationResult,
  StateDiff,
} from "./types.js";
import { forkRpc } from "./forkRpc.js";
import { collectStateDiff } from "./prestate.js";
import { processReceipt } from "./processReceipt.js";

/** Maximum concurrent simulation forks — anvil spawns are expensive. */
const MAX_SIM_FORKS = 5;
let activeForks = 0;

/**
 * Execute a transaction against a freshly-spawned anvil fork and return
 * the full simulation result: success/revert, gas used, decoded logs,
 * state diff, and decoded input. The fork is destroyed 60s after the
 * simulation completes so a follow-up debug trace request can reuse it.
 *
 * Concurrency is capped at MAX_SIM_FORKS to avoid running anvil
 * processes off the cliff under load. Exceeding the cap throws a 429
 * ApiError so the route surfaces a proper status code without
 * string-matching the message.
 */
export async function forkSimulate(
  request: ForkSimulationRequest,
): Promise<ForkSimulationResult> {
  if (activeForks >= MAX_SIM_FORKS) {
    throw new ApiError(
      429,
      "Too many concurrent simulations. Try again in a moment.",
    );
  }

  activeForks++;
  let fork: Fork | null = null;

  try {
    fork = await forkManager.createFork({
      blockNumber: request.blockNumber ?? undefined,
      label: `sim-${Date.now()}`,
    });
    const rpcUrl = fork.rpcUrl;

    // Impersonate the sender + fund them so the tx can pay gas.
    await forkRpc(rpcUrl, "anvil_impersonateAccount", [request.from]);
    await forkRpc(rpcUrl, "anvil_setBalance", [
      request.from,
      "0x" + (10n ** 24n).toString(16), // 1M PLS
    ]);

    const txParams: Record<string, unknown> = {
      from: request.from,
      to: request.to,
      data: request.data ?? "0x",
    };
    if (request.value) txParams.value = request.value;
    if (request.gasLimit) txParams.gas = "0x" + request.gasLimit.toString(16);

    let txHash = "";
    let success = true;
    let revertReason: string | undefined;

    try {
      txHash = (await forkRpc(rpcUrl, "eth_sendTransaction", [
        txParams,
      ])) as string;
    } catch (err) {
      success = false;
      revertReason = err instanceof Error ? err.message : String(err);
    }

    let gasUsed = "0";
    let returnData = "0x";
    let contractAddress: string | undefined;
    let logs: ForkSimulationResult["logs"] = [];

    if (txHash) {
      const outcome = await processReceipt(
        rpcUrl,
        txHash,
        request,
        success,
        revertReason,
      );
      ({ gasUsed, returnData, contractAddress, logs, revertReason } = outcome);
      success = outcome.success;
    }

    let stateDiff: StateDiff = {
      balanceChanges: [],
      storageChanges: [],
      nonceChanges: [],
    };
    // An empty diff says "nothing changed", which is a real outcome for a
    // reverted call and a lie for a failed probe. The flag keeps them apart.
    // A simulation that never produced a tx hash has no diff to collect and
    // nothing to claim, so it stays available with an empty diff.
    let stateDiffAvailable = true;
    if (txHash) {
      try {
        stateDiff = await collectStateDiff(
          rpcUrl,
          txHash,
          request.from,
          request.to,
        );
      } catch (err) {
        console.error("[forkSimulator] state diff collection failed:", err);
        stateDiffAvailable = false;
      }
    }

    let decodedInput: unknown;
    if (request.data && request.to) {
      try {
        const abi = await fetchAbi(request.to);
        if (abi) {
          decodedInput = decodeInput(request.data as Hex, abi);
        }
      } catch {
        // decode is best-effort
      }
    }

    return {
      success,
      returnData,
      gasUsed,
      revertReason,
      stateDiff,
      stateDiffAvailable,
      logs,
      decodedInput,
      blockNumber:
        typeof fork.blockNumber === "number" ? fork.blockNumber : 0,
      txHash: txHash || undefined,
      contractAddress,
    };
  } finally {
    activeForks--;
    if (fork) {
      const id = fork.id;
      // Defer cleanup so follow-up debug trace requests can reuse the fork.
      setTimeout(() => forkManager.destroyFork(id), 60_000);
    }
  }
}
