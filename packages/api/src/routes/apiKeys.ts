import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
} from "../services/apiKeys.js";

const router = Router();

// ---------------------------------------------------------------------------
// Admin guard for the mutating routes
// ---------------------------------------------------------------------------
//
// POST and DELETE had no auth until 2026-10-17: any caller could mint a key
// or delete one. They now need `Authorization: Bearer <API_KEYS_ADMIN_TOKEN>`.
// No token configured means key management is off (503), never open.
// The env var is read per request, so a deploy can set or clear it without
// a code change.
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_KEYS_ADMIN_TOKEN ?? "";
  if (!expected) {
    res.status(503).json({ ok: false, error: "Key management is disabled" });
    return;
  }
  const header = req.headers.authorization ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Compare digests, so the comparison is constant-time at any input length.
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ ok: false, error: "Admin token required" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
});

// ---------------------------------------------------------------------------
// POST /api/keys — Create a new API key
// ---------------------------------------------------------------------------
router.post("/", requireAdminToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = createKeySchema.parse(req.body);
    const result = await createApiKey(name);

    res.status(201).json({
      ok: true,
      apiKey: {
        id: result.id,
        name: result.name,
        // plaintext key returned only once — caller must store it
        key: result.key,
        createdAt: result.createdAt,
      },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ ok: false, error: "Validation error", details: err.errors });
      return;
    }
    console.error("[api-keys] create error:", err);
    res.status(500).json({ ok: false, error: "Failed to create API key" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/keys — List all API keys (hashes excluded)
// ---------------------------------------------------------------------------
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const keys = await listApiKeys();
    res.json({ ok: true, apiKeys: keys });
  } catch (err) {
    console.error("[api-keys] list error:", err);
    res.status(500).json({ ok: false, error: "Failed to list API keys" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/keys/:id — Delete an API key
// ---------------------------------------------------------------------------
router.delete("/:id", requireAdminToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: "Invalid API key ID" });
      return;
    }

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "API key not found" });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[api-keys] delete error:", err);
    res.status(500).json({ ok: false, error: "Failed to delete API key" });
  }
});

export default router;
