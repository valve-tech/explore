import {
  type Hex,
  type Transaction,
  type TransactionReceipt,
  formatEther,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from "viem";
import { chainClient } from "../chains/context.js";
import { fetchAbi, decodeInput, decodeLogs } from "../decoder.js";
import { serialize } from "./client.js";
import { ApiError } from "../../lib/respond.js";
import {
  mergeDecodedLogs,
  otherEmitters,
  toRawLog,
} from "./transactionDetails/transforms.js";

export interface TransactionDetails {
  hash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: number;
  from: string;
  to: string | null;
  value: string;
  valuePLS: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  effectiveGasPrice: string;
  nonce: number;
  input: string;
  status: "success" | "reverted" | "pending";
  timestamp: number | null;
  decodedInput: {
    functionName: string;
    args: { name: string; type: string; value: unknown }[];
  } | null;
  decodedLogs: {
    eventName: string;
    args: { name: string; type: string; value: unknown }[];
    address: string;
    logIndex: number;
  }[];
  rawLogs: {
    address: string;
    topics: string[];
    data: string;
    logIndex: number;
  }[];
  contractAddress: string | null;
  cumulativeGasUsed: string;
  type: string;
}

/**
 * Fetch and decode a single transaction. Combines viem's getTransaction +
 * getTransactionReceipt with ABI-aware decoding of input data and event
 * logs. `skipDecode: true` returns wire data only — useful for hot paths
 * where the caller will decode separately or doesn't need it.
 *
 * Log decoding runs twice: first against the called contract's ABI, then
 * (in full-decode mode) against every distinct emitter in the receipt
 * that hasn't been resolved yet. This handles transactions that touch
 * multiple contracts emitting events from libraries the caller doesn't
 * know about.
 */
export async function getTransactionDetails(
  hash: string,
  options: { skipDecode?: boolean } = {},
): Promise<TransactionDetails> {
  const client = chainClient();

  // Fetch the tx and its receipt in parallel, but treat their failures
  // differently — that's why this is `allSettled`, not `all`. A missing TX is a
  // genuine 404; a missing RECEIPT only means the tx is still in the mempool
  // (pending), which is a valid state to render, not an error. `Promise.all`
  // can't tell them apart (any rejection sinks both), so it turned every
  // pending tx into a misleading "not found".
  const [txResult, receiptResult] = await Promise.allSettled([
    client.getTransaction({ hash: hash as Hex }),
    client.getTransactionReceipt({ hash: hash as Hex }),
  ]);

  // The TX must resolve. viem's typed not-found carries the library version in
  // its message — map it to a clean 404 rather than a 500 that leaks
  // "Version: viem@x.y.z" to the client.
  if (txResult.status === "rejected") {
    if (
      txResult.reason instanceof TransactionNotFoundError ||
      txResult.reason instanceof TransactionReceiptNotFoundError
    ) {
      throw new ApiError(404, "Transaction not found");
    }
    throw txResult.reason;
  }
  const tx = txResult.value;
  if (!tx) throw new ApiError(404, "Transaction not found");

  // No receipt → pending: build from the tx alone. A non-not-found receipt
  // failure is a real error worth surfacing.
  if (receiptResult.status === "rejected") {
    if (receiptResult.reason instanceof TransactionReceiptNotFoundError) {
      return buildPendingTransactionDetails(tx, options);
    }
    throw receiptResult.reason;
  }
  const receipt = receiptResult.value;
  if (!receipt) return buildPendingTransactionDetails(tx, options);

  // Timestamp comes from the mined block; guard the lookup (a tx that lost its
  // block to a reorg between the two reads has a null blockNumber).
  let timestamp: number | null = null;
  if (tx.blockNumber != null) {
    try {
      const block = await client.getBlock({ blockNumber: tx.blockNumber });
      timestamp = Number(block.timestamp);
    } catch {
      // block lookup is best-effort
    }
  }

  return buildTransactionDetails(tx, receipt, timestamp, options);
}

/**
 * Map + ABI-decode an already-fetched tx/receipt into `TransactionDetails`. The
 * fetch and the build are split so the same mapping/decoding can run on raw
 * tx/receipt the CLIENT fetched from its own node (bring-your-own-RPC): the
 * `/api/tx/:hash/from-raw` route formats the client's raw RPC payloads with
 * viem and calls straight in here — no duplicated mapping on the frontend, the
 * raw reads run on the user's node, and the enrichment stays on the backend.
 */
export async function buildTransactionDetails(
  tx: Transaction,
  receipt: TransactionReceipt,
  timestamp: number | null,
  options: { skipDecode?: boolean } = {},
): Promise<TransactionDetails> {
  let decodedInput: TransactionDetails["decodedInput"] = null;
  let decodedLogEntries: TransactionDetails["decodedLogs"] = [];

  // Warm every ABI this build can need in ONE concurrent pass.
  //
  // The calldata decode (tx.to) and the per-emitter log decode below both go
  // through fetchAbi, which caches and de-dupes in-flight requests per address
  // — so once this settles, the awaits further down are cache hits.
  //
  // Why bother: those lookups used to run as two SEQUENTIAL phases — tx.to
  // first, the emitter fan-out second. Against an unreachable verification
  // upstream each phase paid its own connect timeout, so a cold process spent
  // two full timeouts before the breaker had seen enough failures to open.
  // One pass makes the worst case a single timeout rather than one per phase.
  //
  // The address set mirrors exactly what the phases below would fetch, so this
  // adds no upstream calls: `otherEmitters` already excludes tx.to, and tx.to
  // is only warmed under the same conditions that would fetch it anyway — a
  // plain value transfer (no calldata, no logs) still does zero ABI lookups.
  if (!options.skipDecode) {
    const needed = new Set<string>();
    const hasCalldata = Boolean(tx.input) && tx.input !== "0x";
    if (tx.to && (hasCalldata || receipt.logs.length > 0)) {
      needed.add(tx.to.toLowerCase());
    }
    if (receipt.logs.length > 0) {
      for (const addr of otherEmitters(receipt.logs, tx.to ?? null)) needed.add(addr);
    }
    // fetchAbi never rejects — it returns null on any upstream failure — so
    // this cannot introduce a new failure path.
    await Promise.all([...needed].map((addr) => fetchAbi(addr)));
  }

  if (!options.skipDecode) {
    decodedInput = await decodeTxInput(tx.to ?? null, tx.input);
  }

  if (tx.to && !options.skipDecode && receipt.logs.length > 0) {
    const abi = await fetchAbi(tx.to);
    if (abi) {
      // viem's receipt log type is narrower than decodeLogs' input — both
      // share the {address, topics, data} shape, but viem layers branded
      // types we'd have to mirror to match precisely.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decoded = decodeLogs(receipt.logs as any, abi);
      decodedLogEntries = decoded.map((d, i) => ({
        eventName: d.eventName,
        args: d.args,
        address: receipt.logs[i]?.address ?? "",
        logIndex: Number(receipt.logs[i]?.logIndex ?? i),
      }));
    }
  }

  // Second pass: decode logs emitted by contracts other than tx.to.
  // Common for routers that delegate into multiple sub-contracts.
  if (!options.skipDecode && decodedLogEntries.length < receipt.logs.length) {
    // Fetch every emitter's ABI CONCURRENTLY. This loop used to `await`
    // inside the for, so the route's cost was the SUM of the lookups rather
    // than the slowest one. A router tx touching a dozen contracts, any of
    // which miss the ABI cache and fall through to a slow/unreachable
    // verification upstream, blew the caller's 15s budget and returned 504.
    // Concurrency bounds that to the single slowest lookup.
    //
    // fetchAbi already de-dupes in-flight requests per address and never
    // rejects (it returns null on any upstream failure), so a parallel fan-out
    // adds no new failure mode and no duplicate upstream load.
    const emitters = otherEmitters(receipt.logs, tx.to ?? null);
    const abis = await Promise.all(emitters.map((addr) => fetchAbi(addr)));

    // Merge order is still the emitter order above — mergeDecodedLogs is
    // order-sensitive, so resolve concurrently but apply sequentially.
    for (let e = 0; e < emitters.length; e++) {
      const addr = emitters[e]!;
      const abi = abis[e];
      if (!abi) continue;

      const logsForAddr = receipt.logs.filter(
        (l) => l.address.toLowerCase() === addr,
      );
      // viem's branded receipt log type → decodeLogs' looser input.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const decoded = decodeLogs(logsForAddr as any, abi);
      const incoming: TransactionDetails["decodedLogs"] = [];
      for (let i = 0; i < decoded.length; i++) {
        const decodedEntry = decoded[i];
        const originalLog = logsForAddr[i];
        if (!decodedEntry) continue;
        incoming.push({
          eventName: decodedEntry.eventName,
          args: decodedEntry.args,
          address: originalLog?.address ?? addr,
          logIndex: Number(originalLog?.logIndex ?? 0),
        });
      }
      decodedLogEntries = mergeDecodedLogs(decodedLogEntries, incoming);
    }
  }

  const rawLogs = receipt.logs.map(toRawLog);

  return serialize({
    hash: tx.hash,
    blockNumber: tx.blockNumber?.toString() ?? "pending",
    blockHash: tx.blockHash ?? "",
    transactionIndex: Number(tx.transactionIndex),
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    valuePLS: formatEther(tx.value),
    gas: tx.gas.toString(),
    gasPrice: tx.gasPrice?.toString() ?? "0",
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? "0",
    nonce: Number(tx.nonce),
    input: tx.input,
    status: receipt.status === "success" ? "success" : "reverted",
    timestamp,
    decodedInput,
    decodedLogs: decodedLogEntries,
    rawLogs,
    contractAddress: receipt.contractAddress ?? null,
    cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
    type: tx.type ?? "legacy",
  }) as TransactionDetails;
}

/**
 * Decode a transaction's calldata against its target contract's ABI, when both
 * are available. The lone impure step is the (cached) ABI fetch; shared by the
 * mined and pending builders so calldata decoding lives in exactly one place.
 * Returns null for plain value transfers (no `to`/empty input) or unverified
 * targets (no ABI) — the caller renders raw input in those cases.
 */
async function decodeTxInput(
  to: string | null,
  input: string,
): Promise<TransactionDetails["decodedInput"]> {
  if (!to || !input || input === "0x") return null;
  const abi = await fetchAbi(to);
  if (!abi) return null;
  const decoded = decodeInput(input as Hex, abi);
  return decoded
    ? { functionName: decoded.functionName, args: decoded.args }
    : null;
}

/**
 * Build a `TransactionDetails` for a tx that exists but isn't mined yet — it's
 * sitting in the mempool, so there's no receipt and therefore none of the
 * receipt-derived facts (gas used, logs, success/revert, contract address). We
 * still decode the calldata (that needs only the tx + the target ABI), so a
 * pending tx shows what it's *about* to do.
 *
 * `status` is "pending"; receipt-only numbers are zeroed and the log lists are
 * empty. The frontend keys off `status === "pending"` to hide the sections that
 * don't exist yet rather than rendering them as zeros.
 */
export async function buildPendingTransactionDetails(
  tx: Transaction,
  options: { skipDecode?: boolean } = {},
): Promise<TransactionDetails> {
  const decodedInput = options.skipDecode
    ? null
    : await decodeTxInput(tx.to ?? null, tx.input);

  return serialize({
    hash: tx.hash,
    blockNumber: "pending",
    blockHash: "",
    transactionIndex: 0,
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    valuePLS: formatEther(tx.value),
    gas: tx.gas.toString(),
    gasPrice: tx.gasPrice?.toString() ?? "0",
    gasUsed: "0",
    effectiveGasPrice: "0",
    nonce: Number(tx.nonce),
    input: tx.input,
    status: "pending",
    timestamp: null,
    decodedInput,
    decodedLogs: [],
    rawLogs: [],
    contractAddress: null,
    cumulativeGasUsed: "0",
    type: tx.type ?? "legacy",
  }) as TransactionDetails;
}
