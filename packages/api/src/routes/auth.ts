import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { ApiError, asyncRoute, respond } from "../lib/respond.js";
import { sessionCookieSecurity } from "../lib/cors.js";
import { publicClient } from "../services/rpc.js";
import { issueNonce, consumeNonce } from "../services/auth/nonceStore.js";
import {
  mintSession,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../services/auth/sessions.js";

const router = Router();

const verifyBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, "must be 0x-prefixed hex"),
});

/**
 * GET /api/auth/nonce — issue a fresh single-use nonce for the SIWE challenge.
 *
 * Response: { ok: true, nonce, expiresAt }
 *
 * The client builds an EIP-4361 message with `createSiweMessage({ ..., nonce })`
 * (viem/siwe), signs it, and POSTs { message, signature } to /verify. The
 * server-issued nonce is the app binding + replay defense — the SPA is
 * self-hostable from any origin, so the SIWE `domain` is not a fixed value
 * we can validate against; the single-use nonce is.
 */
router.get(
  "/nonce",
  asyncRoute(async (_req: Request, res: Response) => {
    const { nonce, expiresAt } = await issueNonce();
    respond.ok(res, { nonce, expiresAt });
  }, "auth/nonce"),
);

/**
 * POST /api/auth/verify — verify a SIWE signature, consume the nonce, mint a
 * session.
 *
 * Body: { message, signature }   (EIP-4361 message string + its signature)
 * Response: { ok: true, address } (session cookie set as a side effect)
 *
 * Failure modes:
 *  - 400  malformed body (zod)
 *  - 401  unparseable message / bad signature / nonce unknown, used, or expired
 *
 * All 401 paths share one message: a partially-truthful error leaks which
 * check failed, exactly the oracle to avoid for an auth primitive.
 */
router.post(
  "/verify",
  asyncRoute(async (req: Request, res: Response) => {
    const { message, signature } = verifyBodySchema.parse(req.body);

    // The address the message claims + the nonce baked into it.
    const fields = parseSiweMessage(message);
    const address = fields.address;
    const nonce = fields.nonce;
    if (!address || !nonce) {
      throw new ApiError(401, "Authentication failed");
    }

    // Verify the signature over the exact message. EOA recovery is offline;
    // EIP-1271 smart-contract wallets resolve via the public client. Any
    // verifier error collapses to a failed auth.
    let valid = false;
    try {
      valid = await verifySiweMessage(publicClient, {
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new ApiError(401, "Authentication failed");
    }

    // Consume AFTER a good signature so a wallet mis-sign doesn't burn the
    // nonce (the user can re-sign the same challenge). Single-use: a replay of
    // an already-consumed nonce returns false here.
    const consumed = await consumeNonce(nonce);
    if (!consumed) {
      throw new ApiError(401, "Authentication failed");
    }

    const { token, expiresAt } = mintSession(address);
    // SameSite/Secure depend on whether this is an allowlisted cross-origin
    // (IPFS gateway) request — None+Secure there so the cookie rides later
    // cross-origin sync calls; Lax for same-origin. See lib/cors.ts.
    const { sameSite, secure } = sessionCookieSecurity(req);
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite,
      secure,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
      path: "/",
    });
    // Lowercased to match the cookie payload's normalization.
    respond.ok(res, { address: address.toLowerCase(), expiresAt });
  }, "auth/verify"),
);

/**
 * POST /api/auth/logout — clear the session cookie. Idempotent.
 */
router.post(
  "/logout",
  asyncRoute(async (req: Request, res: Response) => {
    // Clear with the SAME SameSite/Secure the cookie was set with, else a
    // cross-origin None+Secure cookie won't be cleared from a gateway origin.
    const { sameSite, secure } = sessionCookieSecurity(req);
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/", sameSite, secure });
    respond.ok(res);
  }, "auth/logout"),
);

export default router;
