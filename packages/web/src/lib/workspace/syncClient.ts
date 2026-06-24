import { apiUrl } from "../apiBase";
import { createSiweMessage } from "viem/siwe";
import type { WalletClient } from "viem";
import type { WorkspaceSyncEnvelope } from "./sync.js";

/**
 * HTTP wrappers for the auth + workspace sync endpoints. Pure transport —
 * no React state, no caching. Higher layers (the useWorkspaceSync hook)
 * orchestrate retries, error handling, and the conflict-detection
 * timing-machine on top.
 *
 * All requests use `credentials: "include"` so the session cookie minted
 * by /api/auth/verify rides along on the workspace sync calls without
 * extra wiring.
 */

// Chain id baked into the SIWE message when the wallet doesn't expose one.
// Informational only — the server binds on the single-use nonce, not chainId.
const FALLBACK_CHAIN_ID = 369;

export interface AuthChallenge {
  nonce: string;
  expiresAt: number;
}

export async function fetchAuthChallenge(): Promise<AuthChallenge> {
  const res = await fetch(apiUrl(`/api/auth/nonce`), { credentials: "include" });
  const body = (await res.json()) as { ok: boolean; nonce?: string; expiresAt?: number; error?: string };
  if (!res.ok || !body.ok || !body.nonce || !body.expiresAt) {
    throw new SyncTransportError(`auth/nonce failed: ${body.error ?? res.status}`);
  }
  return { nonce: body.nonce, expiresAt: body.expiresAt };
}

export interface VerifyResult {
  address: `0x${string}`;
  expiresAt: number;
}

/**
 * Full SIWE-lite handshake: nonce → sign → verify. The session cookie is
 * set as a side effect of the verify response (httpOnly so the page
 * can't read it directly).
 */
export async function authenticate(
  signer: WalletClient,
): Promise<VerifyResult> {
  const account = signer.account;
  if (!account) {
    throw new SyncTransportError("auth: wallet client has no account to sign with");
  }
  const { nonce } = await fetchAuthChallenge();
  // Build the EIP-4361 message the server will parse + verify. The server
  // binds on the server-issued single-use nonce (not domain), so the SPA can
  // be hosted from any origin (e.g. an IPFS gateway).
  const message = createSiweMessage({
    address: account.address,
    chainId: signer.chain?.id ?? FALLBACK_CHAIN_ID,
    domain: window.location.host,
    nonce,
    uri: window.location.origin,
    version: "1",
    statement: "Sign in to Explore to sync your saved workspaces.",
  });
  const signature = await signer.signMessage({ account, message });
  const res = await fetch(apiUrl(`/api/auth/verify`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message, signature }),
  });
  const body = (await res.json()) as {
    ok: boolean;
    address?: `0x${string}`;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.address || !body.expiresAt) {
    throw new SyncTransportError(`auth/verify failed: ${body.error ?? res.status}`);
  }
  return { address: body.address, expiresAt: body.expiresAt };
}

export async function logout(): Promise<void> {
  await fetch(apiUrl(`/api/auth/logout`), { method: "POST", credentials: "include" });
}

export interface PulledEnvelope extends WorkspaceSyncEnvelope {
  serverUpdatedAt: number;
}

/**
 * Pull the user's stored envelope. Returns null when the user has never
 * synced (HTTP 404 from the server). Throws on any other transport
 * failure including 401 (caller should re-authenticate before retrying).
 */
export async function pullSync(): Promise<PulledEnvelope | null> {
  const res = await fetch(apiUrl(`/api/workspaces/sync`), { credentials: "include" });
  if (res.status === 404) return null;
  if (res.status === 401) throw new SyncUnauthorized();
  const body = (await res.json()) as Partial<PulledEnvelope> & {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !body.ok) {
    throw new SyncTransportError(`workspaces/sync GET failed: ${body.error ?? res.status}`);
  }
  // Strip the `ok` wrapper key so the returned shape matches the type.
  const { ok: _ok, error: _err, ...envelope } = body;
  return envelope as PulledEnvelope;
}

export async function pushSync(envelope: WorkspaceSyncEnvelope): Promise<{ serverUpdatedAt: number }> {
  const res = await fetch(apiUrl(`/api/workspaces/sync`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(envelope),
  });
  if (res.status === 401) throw new SyncUnauthorized();
  const body = (await res.json()) as { ok: boolean; serverUpdatedAt?: number; error?: string };
  if (!res.ok || !body.ok || !body.serverUpdatedAt) {
    throw new SyncTransportError(`workspaces/sync PUT failed: ${body.error ?? res.status}`);
  }
  return { serverUpdatedAt: body.serverUpdatedAt };
}

export class SyncUnauthorized extends Error {
  constructor() {
    super("Not signed in");
    this.name = "SyncUnauthorized";
  }
}

export class SyncTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}
