import { Router, type Request, type Response } from "express";
import { ApiError, asyncRoute, respond } from "../../lib/respond.js";
import { getChainPresence } from "../../services/multichain/chainPresence.js";
import { getMergedActivity } from "../../services/multichain/mergedActivity.js";
import { parseChainsParam } from "./schemas.js";
import { chainClient, runWithChain } from "../../services/chains/context.js";
import { listChains } from "../../services/chains/registry.js";

/**
 * Chain-agnostic address routes.
 *
 *   GET /api/multichain/address/:address
 *   GET /api/multichain/address/:address/activity?limit=25
 *
 * Both deliberately IGNORE the request's `chainid`, exactly as /api/resolve
 * does — they exist to answer "which chains?", so binding them to one chain
 * would be incoherent. Chain scope comes from the optional `chains=` allowlist,
 * which carries the UI's testnet toggle.
 */

const router = Router();
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function requireAddress(raw: unknown): string {
  const value = String(raw ?? "");
  if (!ADDRESS_RE.test(value)) throw new ApiError(400, "Invalid address");
  return value.toLowerCase();
}

router.get(
  "/address/:address",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    );
    const presence = await getChainPresence(address, chains);
    respond.ok(res, { result: { address, chains: presence } });
  }, "multichain/address"),
);

router.get(
  "/address/:address/activity",
  asyncRoute(async (req: Request, res: Response) => {
    const address = requireAddress(req.params.address);
    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    );
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1),
      100,
    );

    // Two-phase: the cheap presence probe first, so only chains that actually
    // hold this address pay for the expensive activity fetch.
    const presence = await getChainPresence(address, chains);
    const activity = await getMergedActivity(address, presence, limit);
    respond.ok(res, { result: { address, ...activity } });
  }, "multichain/address/activity"),
);

/**
 * GET /api/multichain/block/:number
 *
 * A block NUMBER is not chain-locatable — every chain past that height has one.
 * So rather than guessing, this reports the height on each chain: the block if
 * the chain has reached it, and the chain's own head if it has not. Chain-
 * agnostic like the address routes.
 */
router.get(
  "/block/:number",
  asyncRoute(async (req: Request, res: Response) => {
    const raw = String(req.params.number ?? "");
    if (!/^\d+$/.test(raw)) throw new ApiError(400, "Block number required");
    const height = BigInt(raw);

    const chains = parseChainsParam(
      typeof req.query.chains === "string" ? req.query.chains : undefined,
    ) ?? listChains().map((c) => c.chainId);

    const result = await Promise.all(
      chains.map((chainId) =>
        runWithChain(chainId, async () => {
          try {
            const client = chainClient();
            const head = await client.getBlockNumber();
            if (head < height) {
              return { chainId, reached: false, head: Number(head) };
            }
            const block = await client.getBlock({ blockNumber: height });
            return {
              chainId,
              reached: true,
              hash: block.hash,
              txCount: block.transactions.length,
              gasUsed: String(block.gasUsed),
              gasLimit: String(block.gasLimit),
              timestamp: Number(block.timestamp),
            };
          } catch {
            // Same rule as the address routes: unknown is not absent.
            return { chainId, reached: false, error: true as const };
          }
        }),
      ),
    );

    respond.ok(res, { result: { height: raw, chains: result } });
  }, "multichain/block"),
);

export default router;
