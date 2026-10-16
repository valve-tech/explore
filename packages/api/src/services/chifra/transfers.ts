/**
 * A token's Transfer history, one bounded page at a time.
 *
 * This read no longer goes through chifra. chifra loads a whole monitor into
 * memory to answer any query on it, and `firstBlock`/`lastBlock`/`maxRecords`
 * do not bound that work (see ./heavyGuard.ts). Measured 2026-10-16 on chain
 * 369 for WPLS (0xA107...9a27): `/export` over a 100-block range and
 * `/list --count` both ran past 60s and returned nothing.
 *
 * The node answers the same question with `eth_getLogs` (address + Transfer
 * topic). The same day, through the server RPC: 50 blocks in 73ms (1,187
 * logs), 200 blocks in 229ms (7,960 logs). A 1,000-block range exceeds the
 * upstream's 20,000-result cap, so this module walks back from a cursor in
 * small chunks, halves a chunk the node calls too large, and stops at a record
 * limit, the window floor or a time budget. Each page returns the cursor for
 * the next one.
 *
 * The route path stays /api/chifra/transfers so existing clients keep working.
 */

import { chainClient, currentChainId } from "../chains/context.js";
import { readCache, writeCache } from "./cache.js";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Default and largest record count for one page. */
export const DEFAULT_PAGE_LIMIT = 1_000;
export const MAX_PAGE_LIMIT = 5_000;

/**
 * Time one page may spend on the node. The browser gives up at 40s and the
 * edge sooner, so a page must answer well inside that. When the budget runs
 * out, the page returns what it has, with `partial: true` and a cursor.
 */
export const PAGE_BUDGET_MS = 10_000;

/** First chunk size, and the bounds for adapting it. */
const INITIAL_SPAN = 200;
const MAX_SPAN = 20_000;

/** Cache life: the head page moves every block; an older page does not. */
export const HEAD_PAGE_TTL_MS = 15_000;
export const CURSOR_PAGE_TTL_MS = 5 * 60_000;

export interface TransferRecord {
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  logIndex: number;
  from: string;
  to: string;
  /** Decimal string. ERC-20 amount, or "1" for an ERC-721 unit. */
  value: string;
  variant: "erc20" | "erc721";
  /** ERC-721 only. */
  tokenId?: string;
}

export interface TransferWindow {
  /** Newest first. */
  records: TransferRecord[];
  /** Lowest block this page read. */
  firstBlock: number;
  /** Highest block this page read (the cursor, or the head). */
  lastBlock: number;
  /** True when older transfers in the window remain (`nextCursor` is set). */
  truncated: boolean;
  /** Pass as `cursor` to read the next older page. Null at the window floor. */
  nextCursor: number | null;
  /** True when the time budget stopped the page early. */
  partial: boolean;
}

/** The page could not read anything. The caller should retry. */
export class TransfersUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransfersUnavailableError";
  }
}

export interface RawLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  blockTimestamp?: string;
  transactionHash?: string;
  logIndex?: string;
}

export interface TransferDeps {
  head: () => Promise<number>;
  getLogs: (token: string, fromBlock: number, toBlock: number) => Promise<RawLog[]>;
  blockTimestamp: (block: number) => Promise<number>;
  now: () => number;
  budgetMs: number;
  /** Cache scope. Defaults to the active chain id. */
  chainKey: string;
}

export interface TransferQuery {
  windowSeconds: number;
  cursor?: number;
  limit?: number;
}

function defaultDeps(): TransferDeps {
  const client = chainClient();
  return {
    head: async () => Number(await client.getBlockNumber()),
    getLogs: (token, fromBlock, toBlock) =>
      client.request({
        method: "eth_getLogs",
        params: [
          {
            address: token as `0x${string}`,
            topics: [TRANSFER_TOPIC],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
          },
        ],
      }) as unknown as Promise<RawLog[]>,
    blockTimestamp: async (block) =>
      Number((await client.getBlock({ blockNumber: BigInt(block) })).timestamp),
    now: () => Date.now(),
    budgetMs: PAGE_BUDGET_MS,
    chainKey: String(currentChainId()),
  };
}

/** True when the node refused a range as too large, so a smaller one may pass. */
export function isRangeTooLarge(err: unknown): boolean {
  const e = err as { message?: unknown; details?: unknown; shortMessage?: unknown } | null;
  const text = [e?.message, e?.details, e?.shortMessage]
    .filter((s) => typeof s === "string")
    .join(" ");
  return /max allowed range|max results|too large|too many|block range|limit exceeded|-32005/i.test(
    text,
  );
}

function hexNum(hex: string | undefined): number {
  if (!hex) return 0;
  try {
    return Number(BigInt(hex));
  } catch {
    return 0;
  }
}

/** A padded 32-byte topic carries an address in its low 20 bytes. */
function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40);
}

function decode(log: RawLog, timestamp: number): TransferRecord {
  const topics = log.topics ?? [];
  // 3 topics: ERC-20 (value in data). 4 topics: ERC-721 (tokenId in topic 3).
  const isErc721 = topics.length === 4;
  let value = "0";
  try {
    value = isErc721 ? "1" : BigInt(log.data && log.data !== "0x" ? log.data : "0x0").toString();
  } catch {
    value = "0";
  }
  return {
    blockNumber: hexNum(log.blockNumber),
    blockTimestamp: timestamp,
    txHash: log.transactionHash ?? "",
    logIndex: hexNum(log.logIndex),
    from: topics[1] ? topicToAddress(topics[1]) : "",
    to: topics[2] ? topicToAddress(topics[2]) : "",
    value,
    variant: isErc721 ? "erc721" : "erc20",
    ...(isErc721 && topics[3] ? { tokenId: BigInt(topics[3]).toString() } : {}),
  };
}

/** Reject after `ms`, so one slow call cannot spend the whole budget. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("transfer page deadline")), Math.max(0, ms));
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Read one page of a token's transfers, newest first, from `cursor` (or the
 * head) back toward `now - windowSeconds`. Throws TransfersUnavailableError
 * when the page could read no block at all.
 */
export async function getTokenTransfers(
  token: string,
  query: TransferQuery,
  deps: TransferDeps = defaultDeps(),
): Promise<TransferWindow> {
  const addr = token.toLowerCase();
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const cacheKey = `transfers:${deps.chainKey}:${addr}:${query.windowSeconds}:${query.cursor ?? "head"}:${limit}`;
  const ttl = query.cursor === undefined ? HEAD_PAGE_TTL_MS : CURSOR_PAGE_TTL_MS;
  const cached = readCache<TransferWindow>(cacheKey, ttl);
  if (cached) return cached;

  const started = deps.now();
  const remaining = () => deps.budgetMs - (deps.now() - started);

  let top: number;
  try {
    top = query.cursor ?? (await withDeadline(deps.head(), remaining()));
  } catch (err) {
    throw new TransfersUnavailableError(
      `could not read the chain head: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  const floorTs = Math.floor(deps.now() / 1000) - query.windowSeconds;

  const records: TransferRecord[] = [];
  let to = top;
  let span = INITIAL_SPAN;
  let reachedFloor = false;
  let partial = false;
  let scannedAny = false;
  let lastError: unknown = null;

  while (records.length < limit && to >= 0 && !reachedFloor) {
    if (remaining() <= 0) {
      partial = true;
      break;
    }
    const from = Math.max(0, to - span + 1);
    let logs: RawLog[];
    try {
      logs = await withDeadline(deps.getLogs(addr, from, to), remaining());
    } catch (err) {
      if (isRangeTooLarge(err) && span > 1) {
        span = Math.max(1, Math.floor(span / 2));
        continue;
      }
      lastError = err;
      partial = true;
      break;
    }

    // Newest first: by block, then by log index.
    logs.sort(
      (a, b) =>
        hexNum(b.blockNumber) - hexNum(a.blockNumber) || hexNum(b.logIndex) - hexNum(a.logIndex),
    );
    const tsByBlock = new Map<number, number>();
    for (const log of logs) {
      const block = hexNum(log.blockNumber);
      let ts = log.blockTimestamp ? hexNum(log.blockTimestamp) : tsByBlock.get(block);
      if (ts === undefined) {
        try {
          ts = await withDeadline(deps.blockTimestamp(block), remaining());
        } catch {
          ts = 0;
        }
      }
      tsByBlock.set(block, ts);
      if (ts > 0 && ts < floorTs) {
        reachedFloor = true;
        continue;
      }
      records.push(decode(log, ts));
    }

    // The chunk's own first block tells if the window floor lies inside it,
    // also when the chunk held no logs.
    if (!reachedFloor) {
      try {
        const fromTs = await withDeadline(deps.blockTimestamp(from), remaining());
        if (fromTs < floorTs) reachedFloor = true;
      } catch {
        // Unknown. Keep walking; the next chunk checks again.
      }
    }

    scannedAny = true;
    to = from - 1;
    if (logs.length < limit / 4) span = Math.min(span * 2, MAX_SPAN);
  }

  if (!scannedAny) {
    const why = lastError ? (lastError as Error)?.message ?? String(lastError) : "time budget spent";
    throw new TransfersUnavailableError(`could not read transfer logs: ${why}`);
  }

  const nextCursor = reachedFloor || to < 0 ? null : to;
  const out: TransferWindow = {
    records,
    firstBlock: to + 1,
    lastBlock: top,
    truncated: nextCursor !== null,
    nextCursor,
    partial,
  };
  if (!partial) writeCache(cacheKey, out);
  return out;
}
