import { apiUrl } from "../lib/apiBase";
import { scoped } from "./chainScope";
import { formatEther, hexToBigInt, hexToNumber } from "viem";
import { DEFAULT_CHAIN_ID } from "../lib/chains";
import { isRpcOverridden } from "../lib/rpcEndpoint";
import { sendRpcRequest, type JsonRpcResponse } from "./rpc";

const API_BASE = apiUrl("/api");

/**
 * Pull a single result off a JSON-RPC response, throwing the node's error
 * message on an error envelope. Used by the bring-your-own-RPC read paths,
 * which talk to the user's node directly instead of our `/api` dispatcher.
 */
function rpcResult(resp: JsonRpcResponse, method: string): string {
  if (resp.error) {
    throw new Error(`${method}: ${resp.error.message ?? "unknown error"}`);
  }
  return (resp.result as string | undefined) ?? "0x";
}


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecodedParam {
  name: string;
  type: string;
  value: unknown;
}

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
  /** "pending" when the tx is in the mempool — no receipt-derived data yet. */
  status: "success" | "reverted" | "pending";
  timestamp: number | null;
  decodedInput: {
    functionName: string;
    args: DecodedParam[];
  } | null;
  decodedLogs: {
    eventName: string;
    args: DecodedParam[];
    address: string;
    logIndex: number;
  }[];
  rawLogs: {
    address: string;
    topics: string[];
    data: string;
    logIndex: number;
  }[];
  internalTransactions: {
    from: string;
    to: string;
    value: string;
    valuePLS: string;
    type: string;
    gas: string;
    gasUsed: string;
    input: string;
    errCode: string;
    isError: string;
  }[];
  tokenTransfers: {
    from: string;
    to: string;
    /** Raw integer amount (base units). Scaled to a human value in the UI. */
    value: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimal: string;
    contractAddress: string;
    hash: string;
  }[];
  contractAddress: string | null;
  cumulativeGasUsed: string;
  type: string;
}

export type TransactionDecode = Pick<
  TransactionDetails,
  "decodedInput" | "decodedLogs"
>;

export interface AddressInfo {
  address: string;
  balance: string;
  balancePLS: string;
  isContract: boolean;
}

export interface AddressTransaction {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  valuePLS: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  functionName: string;
  /**
   * How many candidate signatures leave `functionName` in doubt. 0 when
   * nothing resolved, 1 when the name is settled, N > 1 when it is one guess
   * among N. Not the raw registration count — the server vouches for
   * canonical signatures and reports 1 for them. See
   * `services/signatures/vouched.ts`.
   *
   * OPTIONAL on purpose. Every response this browser cached before the field
   * existed is missing it, and TanStack Query persists those to IndexedDB
   * with `staleTime: Infinity` — so `undefined` genuinely arrives here.
   * Declaring it required would be a type that lies about the wire, and
   * `MethodName` already tests `> 1` rather than `<= 1` for exactly this
   * reason. Treat absent as "not known to be a guess".
   */
  functionCandidates?: number;
  methodId: string;
  input: string;
  type: string;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
}

export interface AddressToken {
  balance: string;
  formattedBalance: string;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: string;
  type: string;
}

export interface ContractInfo {
  address: string;
  isVerified: boolean;
  contractName: string;
  compilerVersion: string;
  optimizationUsed: boolean;
  sourceCode: string;
  abi: unknown[] | null;
  constructorArguments: string;
  evmVersion: string;
  library: string;
  licenseType: string;
  proxy: string;
  implementation: string;
  swarmSource: string;
}

export interface BlockDetails {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: number;
  miner: string;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas: string | null;
  transactionCount: number;
  size: string;
  transactions: Array<{
    hash: string;
    from: string;
    to: string | null;
    value: string;
    valuePLS: string;
    gasUsed: string | null;
    type: string;
    gasPrice: string | null;
    maxFeePerGas: string | null;
    maxPriorityFeePerGas: string | null;
    methodId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error ?? text;
    } catch {
      message = text;
    }
    throw new Error(message);
  }
  const json = (await res.json()) as { ok: boolean; result: T; error?: string };
  if (!json.ok) {
    throw new Error(json.error ?? "Unknown API error");
  }
  return json.result;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchTransaction(
  hash: string,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { decode?: boolean } = {},
): Promise<TransactionDetails> {
  // Bring-your-own-RPC: when a per-chain override is set, fetch the raw tx +
  // receipt straight from the user's node (the heavy reads run on their infra)
  // and hand them to the backend's /from-raw enrichment, which does the
  // mapping + ABI decode + internal/token enrichment. No override → the GET
  // path, byte-identical to before. This path is already complete, so the
  // decode split does not apply — `opts.decode` is ignored here.
  if (isRpcOverridden(chainId)) return readTransactionViaRpc(hash, chainId);

  // `decode: false` → core only (decode=0); the page fetches decode separately
  // via fetchTransactionDecode so it can paint without waiting on it.
  const base = `${API_BASE}/tx/${hash}`;
  const url = opts.decode === false ? `${base}?decode=0` : base;
  return apiFetch<TransactionDetails>(scoped(url, chainId));
}

/**
 * The decode half of the tx page. Hits GET /api/tx/:hash/decode, which returns
 * only { decodedInput, decodedLogs } and 504s (rather than returning empty)
 * when a verified-source upstream is unavailable — so the caller can tell
 * "nothing to decode" from "couldn't decode".
 */
export async function fetchTransactionDecode(
  hash: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<TransactionDecode> {
  return apiFetch<TransactionDecode>(scoped(`${API_BASE}/tx/${hash}/decode`, chainId));
}

/**
 * BYO-RPC transaction read: raw tx + receipt from the user's node, enriched by
 * the backend. We forward the RAW RPC payloads rather than mapping them client-
 * side, so the tx-shape mapping lives in exactly one place (the backend).
 */
async function readTransactionViaRpc(
  hash: string,
  chainId: number,
): Promise<TransactionDetails> {
  const [txRes, receiptRes] = (await Promise.all([
    sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] },
      chainId,
    ),
    sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] },
      chainId,
    ),
  ])) as [JsonRpcResponse, JsonRpcResponse];

  if (txRes.error) throw new Error(`eth_getTransactionByHash: ${txRes.error.message}`);
  if (receiptRes.error) {
    throw new Error(`eth_getTransactionReceipt: ${receiptRes.error.message}`);
  }
  const tx = txRes.result;
  const receipt = receiptRes.result;
  if (!tx || !receipt) throw new Error("Transaction not found");

  return apiFetch<TransactionDetails>(
    scoped(`${API_BASE}/tx/${hash}/from-raw`, chainId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx, receipt }),
    },
  );
}

/**
 * Address overview — balance (wei + formatted PLS) and whether the
 * address holds code. Uses the Etherscan-shaped surface end-to-end:
 *
 *   - module=account&action=balance  → wei string
 *   - module=proxy&action=eth_getCode → "0x" for EOAs, bytecode for contracts
 *
 * Issued in parallel so the two-action migration costs no extra wall
 * time vs. the previous single REST call (the REST endpoint also fired
 * two underlying RPCs).
 *
 * Trade-off vs. the legacy /api/address/:addr REST route: we format
 * `balancePLS` client-side rather than having the server pre-format
 * it. That's fine — `formatEther` is a viem helper, deterministic, and
 * already a dependency.
 */
export async function fetchAddressInfo(
  address: string,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { signal?: AbortSignal } = {},
): Promise<AddressInfo> {
  // Balance + code are raw JSON-RPC reads. When the user has set a per-chain
  // RPC override (bring-your-own-RPC), go DIRECT to their node so the read runs
  // on their infrastructure; otherwise use our canonical `/api` dispatcher,
  // byte-identical to before. Both paths yield the same `{ balance, code }`,
  // so the composition below is shared.
  const { balance, code } = isRpcOverridden(chainId)
    ? await readAddressViaRpc(address, chainId, opts.signal)
    : await readAddressViaDispatcher(address, chainId, opts.signal);

  // An address holds code iff eth_getCode returns more than the empty "0x".
  const isContract = code.length > 2;

  let balancePLS: string;
  try {
    balancePLS = formatEther(BigInt(balance));
  } catch {
    // Non-numeric balance string shouldn't happen, but a malformed upstream
    // response shouldn't crash the address page.
    balancePLS = "0";
  }

  return { address, balance, balancePLS, isContract };
}

/**
 * Address balance + code via the Etherscan-shaped dispatcher (our backend):
 *   - module=account&action=balance  → decimal wei string
 *   - module=proxy&action=eth_getCode → "0x" for EOAs, bytecode for contracts
 * Issued in parallel so the two-action read costs no extra wall time.
 */
async function readAddressViaDispatcher(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<{ balance: string; code: string }> {
  const [balanceRes, codeRes] = await Promise.all([
    fetch(
      scoped(`${API_BASE}?module=account&action=balance&address=${address}`, chainId),
      { signal },
    ),
    fetch(
      scoped(`${API_BASE}?module=proxy&action=eth_getCode&address=${address}&tag=latest`, chainId),
      { signal },
    ),
  ]);

  if (!balanceRes.ok || !codeRes.ok) {
    throw new Error(`Address lookup failed (HTTP ${balanceRes.status} / ${codeRes.status})`);
  }

  const balanceBody = (await balanceRes.json()) as {
    status?: string;
    result?: string;
  };
  const codeBody = (await codeRes.json()) as {
    jsonrpc?: string;
    result?: string;
    error?: { message?: string };
  };

  if (balanceBody.status !== "1") {
    throw new Error(`balance: ${balanceBody.result ?? "unknown error"}`);
  }
  if (codeBody.error) {
    throw new Error(`eth_getCode: ${codeBody.error.message ?? "unknown error"}`);
  }

  return { balance: balanceBody.result ?? "0", code: codeBody.result ?? "0x" };
}

/**
 * Address balance + code straight from the user's RPC node (BYO-RPC). Two
 * parallel single calls rather than a JSON-RPC batch, so we don't assume the
 * node supports batched bodies. `eth_getBalance` returns hex, normalized to the
 * decimal wei string the rest of the app expects.
 */
async function readAddressViaRpc(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<{ balance: string; code: string }> {
  const [balanceRes, codeRes] = (await Promise.all([
    sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] },
      chainId,
      signal,
    ),
    sendRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] },
      chainId,
      signal,
    ),
  ])) as [JsonRpcResponse, JsonRpcResponse];

  const balanceHex = rpcResult(balanceRes, "eth_getBalance");
  const code = rpcResult(codeRes, "eth_getCode");
  return { balance: hexToBigInt(balanceHex as `0x${string}`).toString(), code };
}

/**
 * One page of an address's transactions. `opts.signal` is how the address
 * workspace puts a client-side deadline on the read — chifra can spend tens of
 * seconds on a busy address, and without a signal the browser waits forever
 * when the answer never comes.
 */
export async function fetchAddressTransactions(
  address: string,
  page: number = 1,
  limit: number = 25,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { signal?: AbortSignal } = {},
): Promise<{ transactions: AddressTransaction[]; total: number }> {
  return apiFetch<{ transactions: AddressTransaction[]; total: number }>(
    scoped(`${API_BASE}/address/${address}/txs?page=${page}&limit=${limit}`, chainId),
    { signal: opts.signal },
  );
}

export async function fetchAddressTokens(
  address: string,
  chainId: number = DEFAULT_CHAIN_ID,
  opts: { signal?: AbortSignal } = {},
): Promise<AddressToken[]> {
  return apiFetch<AddressToken[]>(scoped(`${API_BASE}/address/${address}/tokens`, chainId), {
    signal: opts.signal,
  });
}

export interface TokenMetaInfo {
  address: string;
  decimals: number | null;
  symbol: string | null;
  name: string | null;
}

/** ERC-20/721 decimals/symbol/name — server-side read + cache (replaces the
 *  old client-side viem read, so the browser never hits an RPC for metadata). */
export async function fetchTokenMeta(
  address: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<TokenMetaInfo> {
  return apiFetch<TokenMetaInfo>(scoped(`${API_BASE}/token/${address}/meta`, chainId));
}

export interface ChifraTransfer {
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  value: string;
  variant: "erc20" | "erc721";
  tokenId?: string;
}
export interface ChifraTransferWindow {
  records: ChifraTransfer[];
  firstBlock: number;
  lastBlock: number;
  truncated: boolean;
}
export type ChifraWindow = "24h" | "7d" | "30d";

/** A token's normalized transfer history over a window (chifra-backed). */
export async function fetchTokenTransfers(
  token: string,
  window: ChifraWindow = "24h",
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<ChifraTransferWindow> {
  return apiFetch<ChifraTransferWindow>(
    scoped(`${API_BASE}/chifra/transfers?token=${token}&window=${window}`, chainId),
  );
}

export async function fetchContractInfo(
  address: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<ContractInfo> {
  return apiFetch<ContractInfo>(scoped(`${API_BASE}/contract/${address}`, chainId));
}

// ---------------------------------------------------------------------------
// Block — Etherscan-shaped proxy module
// ---------------------------------------------------------------------------

/**
 * A block lookup key is either a 32-byte hash, a decimal block number,
 * a hex-encoded block number, or one of the symbolic tags. We dispatch
 * by shape rather than asking the caller which kind it is.
 */
function isHash(input: string): boolean {
  return input.startsWith("0x") && input.length === 66;
}

function toBlockTag(input: string): string {
  if (input.startsWith("0x")) return input;
  if (input === "latest" || input === "earliest" || input === "pending") {
    return input;
  }
  return `0x${BigInt(input).toString(16)}`;
}

/**
 * Raw RPC tx shape we read off the block payload when `boolean=true`.
 * Optional EIP-1559 fields (`maxFeePerGas`, `maxPriorityFeePerGas`) are
 * only present on type-2 transactions.
 */
interface RpcBlockTx {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasPrice?: string | null;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
  type?: string;
  input?: string;
}

interface RpcBlock {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string | null;
  size: string;
  transactions: RpcBlockTx[];
}

/**
 * Block details over the Etherscan-shaped surface:
 *
 *   - hash input   → module=proxy&action=eth_getBlockByHash&hash=0x..&boolean=true
 *   - number input → module=proxy&action=eth_getBlockByNumber&tag=0x..&boolean=true
 *
 * We hex-encode decimal block numbers client-side because the dispatcher
 * forwards `tag` straight to the RPC node, which only speaks hex/symbolic
 * tags. The block payload arrives with hex everywhere; this function is
 * the *only* place we convert hex → decimal-string for the rest of the
 * app to consume.
 *
 * Trade-off vs. the legacy /api/block/:numberOrHash REST route: that
 * endpoint fired N+1 receipt calls to populate per-tx `gasUsed`. Nothing
 * in BlockView reads that field today, so the migration drops the
 * receipt fan-out entirely. Per-tx `gasUsed` is `null` from now on; if a
 * future consumer needs it, fetch receipts lazily at the row level.
 */
export async function fetchBlock(
  numberOrHash: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<BlockDetails> {
  // eth_getBlockBy* is a raw read: direct to the user's node when a BYO-RPC
  // override is set, else through our canonical dispatcher (byte-identical to
  // before). Both yield the same `RpcBlock`, mapped to `BlockDetails` below.
  const rpc = isRpcOverridden(chainId)
    ? await readBlockViaRpc(numberOrHash, chainId)
    : await readBlockViaDispatcher(numberOrHash, chainId);

  if (!rpc) {
    throw new Error(`Block not found: ${numberOrHash}`);
  }

  return mapRpcBlock(rpc);
}

/** `eth_getBlockBy*` over the Etherscan-shaped dispatcher (our backend). */
async function readBlockViaDispatcher(
  numberOrHash: string,
  chainId: number,
): Promise<RpcBlock | null> {
  const url = isHash(numberOrHash)
    ? `${API_BASE}?module=proxy&action=eth_getBlockByHash&hash=${numberOrHash}&boolean=true`
    : `${API_BASE}?module=proxy&action=eth_getBlockByNumber&tag=${toBlockTag(numberOrHash)}&boolean=true`;

  const res = await fetch(scoped(url, chainId));
  if (!res.ok) {
    throw new Error(`Block lookup failed (HTTP ${res.status})`);
  }

  const body = (await res.json()) as {
    jsonrpc?: string;
    result?: RpcBlock | null;
    error?: { message?: string };
  };

  if (body.error) {
    throw new Error(`eth_getBlockBy*: ${body.error.message ?? "unknown error"}`);
  }
  return body.result ?? null;
}

/** `eth_getBlockBy*` straight from the user's RPC node (BYO-RPC). */
async function readBlockViaRpc(
  numberOrHash: string,
  chainId: number,
): Promise<RpcBlock | null> {
  const resp = (await sendRpcRequest(
    {
      jsonrpc: "2.0",
      id: 1,
      method: isHash(numberOrHash) ? "eth_getBlockByHash" : "eth_getBlockByNumber",
      params: [
        isHash(numberOrHash) ? numberOrHash : toBlockTag(numberOrHash),
        true,
      ],
    },
    chainId,
  )) as JsonRpcResponse;

  if (resp.error) {
    throw new Error(`eth_getBlockBy*: ${resp.error.message ?? "unknown error"}`);
  }
  return (resp.result as RpcBlock | null) ?? null;
}

/**
 * Map a raw `RpcBlock` (hex everywhere) to `BlockDetails` (decimal strings).
 * This is the *only* place we convert hex → decimal for the rest of the app,
 * shared across both transports so the shapes can never drift.
 */
function mapRpcBlock(rpc: RpcBlock): BlockDetails {
  // Per-tx mapping. methodId is derived from `input` (first 4 bytes), and
  // valuePLS uses viem's formatEther — both moved client-side because the
  // raw RPC payload doesn't include them.
  const transactions: BlockDetails["transactions"] = rpc.transactions.map(
    (tx) => {
      let valuePLS: string;
      try {
        valuePLS = formatEther(hexToBigInt(tx.value as `0x${string}`));
      } catch {
        valuePLS = "0";
      }
      const methodId =
        tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : "0x";
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: hexToBigInt(tx.value as `0x${string}`).toString(),
        valuePLS,
        // gasUsed is receipt-only data; we no longer fan out N+1 receipt
        // calls just to fill this in. See trade-off note above.
        gasUsed: null,
        type: tx.type ?? "0x0",
        gasPrice: tx.gasPrice ?? null,
        maxFeePerGas: tx.maxFeePerGas ?? null,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
        methodId,
      };
    },
  );

  return {
    number: hexToBigInt(rpc.number as `0x${string}`).toString(),
    hash: rpc.hash,
    parentHash: rpc.parentHash,
    timestamp: hexToNumber(rpc.timestamp as `0x${string}`),
    miner: rpc.miner,
    gasUsed: hexToBigInt(rpc.gasUsed as `0x${string}`).toString(),
    gasLimit: hexToBigInt(rpc.gasLimit as `0x${string}`).toString(),
    baseFeePerGas: rpc.baseFeePerGas
      ? hexToBigInt(rpc.baseFeePerGas as `0x${string}`).toString()
      : null,
    transactionCount: rpc.transactions.length,
    size: hexToBigInt(rpc.size as `0x${string}`).toString(),
    transactions,
  };
}
