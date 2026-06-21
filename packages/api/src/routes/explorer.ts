import { Router, type Request, type Response } from "express";
import {
  formatTransaction,
  formatTransactionReceipt,
  parseAbi,
  type RpcTransaction,
  type RpcTransactionReceipt,
} from "viem";
import {
  getTransactionDetails,
  buildTransactionDetails,
  getInternalTransactions,
  getTokenTransfers,
  getAddressTransactions,
  getAddressTokens,
  getContractInfo,
  getBlockDetails,
  getAddressBalance,
  isContract,
} from "../services/explorer.js";
import { chainClient, currentChainId } from "../services/chains/context.js";
import { ApiError, asyncRoute, respond } from "../lib/respond.js";

const router = Router();

// ERC-20/721 metadata reads for GET /token/:address/meta. decimals() is
// immutable, so a successful read is cached for the process lifetime; symbol()
// and name() are best-effort.
const ERC20_META_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);
interface TokenMetaResult {
  decimals: number | null;
  symbol: string | null;
  name: string | null;
}
const tokenMetaCache = new Map<string, TokenMetaResult>();

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function requireAddress(raw: string | string[] | undefined): string {
  const address = String(raw ?? "");
  if (!ADDRESS_RE.test(address)) throw new ApiError(400, "Invalid address");
  return address;
}

/** Resolve `p`, or `fallback` if it hasn't settled within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// GET /api/tx/:hash
// ---------------------------------------------------------------------------

router.get(
  "/tx/:hash",
  asyncRoute(async (req: Request, res: Response) => {
    const hash = String(req.params.hash ?? "");
    if (!HASH_RE.test(hash)) {
      throw new ApiError(400, "Invalid transaction hash");
    }

    // RPC can be slow for complex txs — 15s timeout per call. The details
    // fetch keeps its reject semantics (a genuine 404 must surface as 404, not
    // be swallowed into the timeout's null → a misleading 504). The two
    // enrichment calls are best-effort: a pending tx has no trace/transfers
    // yet, so a rejection there degrades to [] rather than sinking the detail.
    const [details, internalTxs, tokenTransfers] = await Promise.all([
      withTimeout(
        getTransactionDetails(hash),
        15_000,
        null as Awaited<ReturnType<typeof getTransactionDetails>> | null,
      ),
      withTimeout(getInternalTransactions(hash).catch(() => []), 10_000, []),
      withTimeout(getTokenTransfers(hash).catch(() => []), 10_000, []),
    ]);

    if (!details) {
      throw new ApiError(
        504,
        "Transaction fetch timed out — PulseChain RPC may be slow",
      );
    }

    respond.ok(res, {
      result: {
        ...details,
        internalTransactions: internalTxs,
        tokenTransfers,
      },
    });
  }, "explorer/tx"),
);

// ---------------------------------------------------------------------------
// POST /api/tx/:hash/from-raw
// ---------------------------------------------------------------------------
//
// Bring-your-own-RPC companion to GET /api/tx/:hash. The client fetches the raw
// tx + receipt from ITS OWN node (so the heavy raw reads run on the user's
// infrastructure, consistent with the BYO block/balance/code reads) and POSTs
// them here. We format them with viem and run the SAME mapping + ABI decoding
// the GET route uses, then add the enrichment that can only come from the
// backend (internal txs via debug_trace, token transfers via the indexer). No
// transaction mapping is duplicated on the frontend.

router.post(
  "/tx/:hash/from-raw",
  asyncRoute(async (req: Request, res: Response) => {
    const hash = String(req.params.hash ?? "");
    if (!HASH_RE.test(hash)) {
      throw new ApiError(400, "Invalid transaction hash");
    }

    const body = req.body as { tx?: unknown; receipt?: unknown };
    if (!body || typeof body.tx !== "object" || typeof body.receipt !== "object") {
      throw new ApiError(400, "Body must include raw `tx` and `receipt` objects");
    }

    // Parse the client's raw RPC payloads (hex everywhere) into viem's shape.
    // Malformed input → 400, not a 500: this is user-supplied data.
    let details;
    try {
      const tx = formatTransaction(body.tx as RpcTransaction);
      const receipt = formatTransactionReceipt(body.receipt as RpcTransactionReceipt);
      if (tx.hash?.toLowerCase() !== hash.toLowerCase()) {
        throw new ApiError(400, "Raw tx hash does not match the path");
      }
      let timestamp: number | null = null;
      try {
        if (tx.blockNumber != null) {
          const block = await chainClient().getBlock({ blockNumber: tx.blockNumber });
          timestamp = Number(block.timestamp);
        }
      } catch {
        // timestamp is best-effort, same as the GET route
      }
      details = await buildTransactionDetails(tx, receipt, timestamp);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, "Malformed raw tx/receipt payload");
    }

    const [internalTxs, tokenTransfers] = await Promise.all([
      withTimeout(getInternalTransactions(hash), 10_000, []),
      withTimeout(getTokenTransfers(hash), 10_000, []),
    ]);

    respond.ok(res, {
      result: {
        ...details,
        internalTransactions: internalTxs,
        tokenTransfers,
      },
    });
  }, "explorer/tx-from-raw"),
);

// ---------------------------------------------------------------------------
// GET /api/address/:address/txs
// ---------------------------------------------------------------------------

router.get(
  "/address/:address/txs",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const page = parseInt(String(req.query.page ?? "1"), 10) || 1;
    const limit = Math.min(
      parseInt(String(req.query.limit ?? "25"), 10) || 25,
      100,
    );

    const result = await getAddressTransactions(address, page, limit);
    respond.ok(res, { result });
  }, "explorer/address/txs"),
);

// ---------------------------------------------------------------------------
// GET /api/address/:address/tokens
// ---------------------------------------------------------------------------

router.get(
  "/address/:address/tokens",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const tokens = await getAddressTokens(address);
    respond.ok(res, { result: tokens });
  }, "explorer/address/tokens"),
);

// ---------------------------------------------------------------------------
// GET /api/token/:address/meta — ERC-20/721 decimals/symbol/name (cached).
// Server-side replacement for the old client-side viem read, so the browser
// never has to hit an RPC directly for token metadata.
// ---------------------------------------------------------------------------

router.get(
  "/token/:address/meta",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const key = `${currentChainId()}|${address.toLowerCase()}`;
    let meta = tokenMetaCache.get(key);
    if (!meta) {
      const client = chainClient();
      const read = async (fn: "decimals" | "symbol" | "name") => {
        try {
          return await client.readContract({
            address: address as `0x${string}`,
            abi: ERC20_META_ABI,
            functionName: fn,
          });
        } catch {
          return null;
        }
      };
      const [d, s, n] = await Promise.all([read("decimals"), read("symbol"), read("name")]);
      meta = {
        decimals: d === null ? null : Number(d),
        symbol: (s as string) || null,
        name: (n as string) || null,
      };
      // decimals() is immutable — cache a real read; don't pin a failed one.
      if (meta.decimals !== null) tokenMetaCache.set(key, meta);
    }
    respond.ok(res, { result: { address, ...meta } });
  }, "explorer/token/meta"),
);

// ---------------------------------------------------------------------------
// GET /api/address/:address (balance + type)
// ---------------------------------------------------------------------------

router.get(
  "/address/:address",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const [balance, isContractAddr] = await Promise.all([
      getAddressBalance(address),
      isContract(address),
    ]);

    respond.ok(res, {
      result: {
        address,
        ...balance,
        isContract: isContractAddr,
      },
    });
  }, "explorer/address"),
);

// ---------------------------------------------------------------------------
// GET /api/contract/:address
// ---------------------------------------------------------------------------

router.get(
  "/contract/:address",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const info = await getContractInfo(address);
    respond.ok(res, { result: info });
  }, "explorer/contract"),
);

// ---------------------------------------------------------------------------
// GET /api/block/:numberOrHash
// ---------------------------------------------------------------------------

router.get(
  "/block/:numberOrHash",
  asyncRoute(async (req: Request, res: Response) => {
    const numberOrHash = String(req.params.numberOrHash ?? "");
    if (!numberOrHash) {
      throw new ApiError(400, "Block number or hash required");
    }

    const block = await getBlockDetails(numberOrHash);
    respond.ok(res, { result: block });
  }, "explorer/block"),
);

export default router;
