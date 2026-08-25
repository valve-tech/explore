/**
 * Gas oracle route — priority-fee tier recommendations.
 *
 *   GET /api/gas/oracle  — slow/standard/fast/instant tiers + base fee +
 *                          trend + mempool stats, mempool-influenced.
 *
 * Service: services/gasOracle.ts (one shared server-side poller).
 */

import { Router, type Request, type Response } from "express";
import type { GasOracleState } from "@valve-tech/gas-oracle";
import { asyncRoute, respond } from "../lib/respond.js";
import { getGasTiers } from "../services/gasOracle.js";
import { serialize } from "../services/explorer/client.js";

const router = Router();

/**
 * Project the poller's state onto the fields a client can use.
 *
 * `GasOracleState` is a PRODUCER state object, not a wire format, and the
 * package says so four times over: `ring`, `mempoolSamples`,
 * `lastPublishedTips` and `lastPublishedBlockNumber` are "producer-local",
 * and "wire publishers should strip before serializing". `toPublishable` —
 * the function the docs name — lives in the relay, not in this package, so
 * the projection has to be ours. It never was, and we shipped the lot.
 *
 * What that cost, measured on production 2026-08-25 for chain 369:
 *
 *   full payload        647,932 bytes
 *     ring              637,606 bytes   98.4%   20 blocks x every tx's tip
 *     mempoolSamples      8,866 bytes    1.4%
 *     everything real     1,158 bytes    0.2%
 *
 * The explorer home page polls this every 5 seconds, so one open tab pulled
 * about 7.4 MB per minute to render four numbers. No client read any of it:
 * `packages/web/src/api/gas.ts` declares six fields and none of them are
 * producer-local.
 *
 * `lastReorg` is kept. The package marks it producer-local too but adds
 * "safe to ship over the wire", it is a single small object, and a reorg
 * indicator is worth having a client able to read.
 */
function toWire(state: GasOracleState) {
  const {
    chainId,
    blockNumber,
    timestamp,
    baseFee,
    baseFeeTrend,
    baseFeeHistory,
    mempool,
    blob,
    tiers,
    lastReorg,
  } = state;
  return {
    chainId,
    blockNumber,
    timestamp,
    baseFee,
    baseFeeTrend,
    baseFeeHistory,
    mempool,
    blob,
    tiers,
    lastReorg,
  };
}

router.get(
  "/oracle",
  asyncRoute(async (_req: Request, res: Response) => {
    const state = await getGasTiers();
    respond.ok(res, { result: serialize(toWire(state)) });
  }, "gas/oracle"),
);

export default router;
