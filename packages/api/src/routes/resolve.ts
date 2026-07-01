/**
 * Cross-chain resolve route.
 *
 *   GET /api/resolve?q=0x…
 *
 * Given a pasted tx hash, address, or block number, reports which registered
 * chain(s) it exists on (see services/resolve/resolveEntity.ts). The search
 * UIs use this to route a global (chain-unspecified) search to the chain the
 * entity actually lives on, instead of defaulting to one chain. Chain-agnostic
 * by design — it ignores the request's `chainid` and probes every chain.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ApiError, asyncRoute, respond } from "../lib/respond.js";
import { resolveEntity } from "../services/resolve/resolveEntity.js";

const router = Router();

const resolveQuery = z.object({
  // 66 chars covers the longest locatable input (a 0x + 64-hex tx hash).
  q: z.string().trim().min(1, "q is required").max(66, "q is too long"),
});

router.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = resolveQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const result = await resolveEntity(parsed.data.q);
    respond.ok(res, { result });
  }, "resolve"),
);

export default router;
