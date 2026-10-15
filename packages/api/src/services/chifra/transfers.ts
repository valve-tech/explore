/**
 * Token transfer history via chifra, normalized for charting.
 *
 * Uses @valve-tech/trueblocks-sdk (a typed client to the chifra daemon) for
 * two calls:
 *   - `when`        — map a unix timestamp to the block at that time, so a
 *                     time window becomes an exact block range (no
 *                     blocks-per-second estimate that drifts).
 *   - `export.logs` — raw logs for txs the token appears in. chifra's
 *                     `transfers` accounting mode and `articulate` both
 *                     require node features this deployment lacks (archive
 *                     accounting / Etherscan key), so we pull raw logs and
 *                     decode the standard ERC-20/721 Transfer event ourselves.
 *
 * Results are wrapped in the in-memory TTL cache (see ./cache.ts) keyed by
 * (token, firstBlock, lastBlock) so repeat window requests don't re-walk
 * chifra.
 */

import { createTrueblocksClient } from "@valve-tech/trueblocks-sdk";
import { withChifraToken } from "./edgeToken.js";
import { readCache, writeCache } from "./cache.js";
import { currentChain } from "../chains/context.js";

const CHIFRA_BASE = process.env.CHIFRA_BASE_URL || "https://chifra.valve.city";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Cap on records pulled from chifra per window. Bounds latency + memory. */
const MAX_RECORDS = 10_000;

/**
 * chifra cold-cache walks (especially for high-record tokens like HEX) can
 * take 10s+, and `/when` occasionally returns a transient 500. Bound each
 * request at 30s and retry transient failures so one flake doesn't fail the
 * whole window. The SDK has no built-in timeout, so we inject one via fetch.
 */
const CHIFRA_TIMEOUT_MS = 30_000;

const client = createTrueblocksClient({
  baseUrl: CHIFRA_BASE,
  fetch: (input, init) =>
    fetch(input, { ...withChifraToken(init), signal: AbortSignal.timeout(CHIFRA_TIMEOUT_MS) }),
});

/** Retry a chifra call up to `attempts` times on any failure (transient 5xx). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

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
  records: TransferRecord[];
  firstBlock: number;
  lastBlock: number;
  /** True when the window hit MAX_RECORDS and older transfers were dropped. */
  truncated: boolean;
}

/** A padded 32-byte topic carries an address in its low 20 bytes. */
function topicToAddress(topic: string): string {
  return "0x" + topic.slice(-40);
}

/**
 * Pull a numeric `blockNumber` out of a `when` response. The verb returns a
 * union (count | message | namedBlock | timestamp); only the block-bearing
 * variants have the field, so narrow before reading.
 */
function blockNumberOf(entry: unknown): number | null {
  if (entry && typeof entry === "object" && "blockNumber" in entry) {
    const n = (entry as { blockNumber?: unknown }).blockNumber;
    if (typeof n === "number") return n;
  }
  return null;
}

/** Resolve a unix timestamp (seconds) to the block mined at/just before it. */
async function blockAtTimestamp(unixSeconds: number): Promise<number | null> {
  const res = await withRetry(() =>
    client.when({ blocks: [String(unixSeconds)], chain: currentChain().chifraChain }),
  );
  return blockNumberOf(res.data?.[0]);
}

/** Current chain head block number. */
async function headBlock(): Promise<number | null> {
  const res = await withRetry(() =>
    client.when({ blocks: ["latest"], chain: currentChain().chifraChain }),
  );
  return blockNumberOf(res.data?.[0]);
}

/**
 * Fetch + normalize token transfers within a time window (seconds back from
 * now). Returns newest-first. `null` on upstream failure.
 */
export async function getTokenTransfers(
  token: string,
  windowSeconds: number,
): Promise<TransferWindow | null> {
  const now = Math.floor(Date.now() / 1000);
  const [head, start] = await Promise.all([
    headBlock(),
    blockAtTimestamp(now - windowSeconds),
  ]);
  if (head === null || start === null) return null;

  const chain = currentChain().chifraChain;
  const addr = token.toLowerCase();
  const cacheKey = `transfers:${chain}:${addr}:${start}-${head}`;
  const cached = readCache<TransferWindow>(cacheKey);
  if (cached) return cached;

  const res = await client.export.logs({
    addrs: [addr],
    firstBlock: start,
    lastBlock: head,
    reversed: true,
    maxRecords: MAX_RECORDS,
    chain,
  });
  if (!res.data) return null;

  const records: TransferRecord[] = [];
  for (const log of res.data) {
    const topics = (log.topics ?? []) as string[];
    if (topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if ((log.address ?? "").toLowerCase() !== addr) continue;

    // 3 topics → ERC-20 (value in data); 4 topics → ERC-721 (tokenId in topic[3])
    const isErc721 = topics.length === 4;
    records.push({
      blockNumber: log.blockNumber ?? 0,
      blockTimestamp: log.timestamp ?? 0,
      txHash: log.transactionHash ?? "",
      logIndex: log.logIndex ?? 0,
      from: topics[1] ? topicToAddress(topics[1]) : "",
      to: topics[2] ? topicToAddress(topics[2]) : "",
      value: isErc721 ? "1" : BigInt(log.data || "0x0").toString(),
      variant: isErc721 ? "erc721" : "erc20",
      ...(isErc721 && topics[3]
        ? { tokenId: BigInt(topics[3]).toString() }
        : {}),
    });
  }

  const out: TransferWindow = {
    records,
    firstBlock: start,
    lastBlock: head,
    truncated: res.data.length >= MAX_RECORDS,
  };
  writeCache(cacheKey, out);
  return out;
}
