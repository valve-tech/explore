/**
 * Network-health route — transaction prioritization & fee-burn analysis.
 *
 *   GET /api/network-health?before=<blockNum>&limit=256
 *     → { aggregate, blocks[] } for the active chain (resolved by chainContext).
 *       `before` (exclusive) drives load-more; omit it for the latest window.
 *
 * Service: services/networkHealth/* (pure compute + per-chain in-memory cache).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ApiError, asyncRoute, respond } from "../lib/respond.js";
import { currentChainId } from "../services/chains/context.js";
import {
  getNetworkHealth,
  INITIAL_WINDOW,
  MAX_LIMIT,
} from "../services/networkHealth/cache.js";
import { ReceiptsUnsupportedError } from "../services/networkHealth/fetch.js";

const router = Router();

const querySchema = z.object({
  before: z
    .string()
    .regex(/^\d+$/, "before must be a decimal block number")
    .optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

router.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const { before, limit } = querySchema.parse(req.query);
    try {
      const result = await getNetworkHealth(
        currentChainId(),
        before ? BigInt(before) : null,
        limit ?? INITIAL_WINDOW,
      );
      // serializeBlock/aggregateWindow already stringify bigints.
      respond.ok(res, { result });
    } catch (err) {
      if (err instanceof ReceiptsUnsupportedError) {
        throw new ApiError(501, err.message, { receiptsUnsupported: true });
      }
      throw err;
    }
  }, "network-health"),
);

export default router;
