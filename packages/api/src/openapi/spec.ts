/**
 * Hand-written OpenAPI 3.1 document for `explore.valve.city`'s REST
 * surface. Companion to the monorepo's spec at `one.valve.city/openapi.json`:
 *   - `one.valve.city/` (manifest) → `services[0].docs.openapi` →
 *     `explore.valve.city/openapi.json` (this document)
 *
 * The two repos own their slices independently; the manifest link is
 * the only coupling.
 *
 * Slice 1 scope: federation infrastructure + a thin starter (the
 * always-public /health) so the federation contract works end-to-end
 * the day this commit lands. Per-route coverage fills in tag-by-tag
 * via the drift gate's allow-list rollout.
 *
 * Authoring contract:
 *   - Documented routes carry: method, summary, description,
 *     parameters/requestBody, responses (200 + each documented error),
 *     security (or empty for public).
 *   - The drift gate (drift.test.ts) asserts every Express route on
 *     the live app is either covered here or in the allow-list.
 *   - `/rpc` is JSON-RPC and described in prose in the appendix.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { OpenAPIObject, ResponseObject } from "./types.js";
import {
  PUBLIC_BASE_URL,
  PUBLIC_HOST,
  BRAND_TITLE,
  BRAND_NAME,
  CONTACT_EMAIL,
  LOCAL_SERVER_URL,
  FEDERATION_MANIFEST_URL,
} from "./branding.js";
import { getChain, DEFAULT_CHAIN_ID } from "../services/chains/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"),
) as { version: string };

/**
 * Standard `{ error: string }` envelope used by hand-written routes.
 */
export const errorResponse = (description: string): ResponseObject => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
    },
  },
});

/**
 * The OpenAPI `info.description` prose. Built from branding + the chain
 * registry so a self-hosted instance describes ITSELF — its own host, brand,
 * and default chain — instead of advertising `explore.valve.city` / PulseChain.
 * The federation section is emitted only when a manifest URL is configured
 * (`OPENAPI_FEDERATION_URL`); a standalone self-host with no federation drops
 * it entirely. Defaults reproduce the hosted deployment's text.
 */
function buildAppendix(): string {
  const defaultChain = getChain(DEFAULT_CHAIN_ID);
  const slug = BRAND_NAME.toLowerCase();

  const surfaces = `
# Surfaces

\`${PUBLIC_HOST}\` exposes the ${BRAND_NAME} platform — transaction simulation,
opcode debugger, virtual testnets (Anvil forks), monitoring/alerting,
serverless Web3 Actions, and an enhanced JSON-RPC proxy for ${defaultChain.name}
(chain ID ${defaultChain.chainId}).

## /rpc — JSON-RPC proxy (${defaultChain.name})

\`POST /rpc\` accepts any standard EVM JSON-RPC method (eth_*, debug_*,
trace_*, …) and proxies to the configured upstream node. The proxy
adds a small cache layer in front of expensive method families
(\`eth_call\`, \`debug_traceTransaction\`) and rewrites a few methods to
hit chifra for paginated history (\`ots_searchTransactionsBefore\` /
\`...After\`).

## /api/rpc — same as /rpc, authenticated

Same upstream + cache as /rpc; gated on a project API key from
\`POST /api/keys\` (out-of-scope today; covered in a follow-up tag).

## /ws/alerts — WebSocket alert stream

\`/ws/alerts\` streams alert firings as they evaluate against the
block-poller's tail. Frame shape is documented in
\`packages/api/src/services/alerts/types.ts\`. AsyncAPI 3.0 covers this
category but a prose paragraph is more useful for a single-shape
stream — formal coverage deferred.`.trim();

  if (!FEDERATION_MANIFEST_URL) return surfaces;

  const federation = `
# Federation

This document is the \`${slug}\` slice of an OpenAPI federation. The
discovery root lives at \`${FEDERATION_MANIFEST_URL}\` (Supabase-style
manifest) and advertises this URL under \`services[].docs.openapi\`.
Integrators following \`${FEDERATION_MANIFEST_URL} → services → ${slug}\`
land here without prior knowledge of this hostname.`.trim();

  return `${surfaces}\n\n${federation}`;
}

const APPENDIX = buildAppendix();

export const spec: OpenAPIObject = {
  openapi: "3.1.0",
  info: {
    title: BRAND_TITLE,
    version: pkg.version,
    description: APPENDIX,
    contact: { email: CONTACT_EMAIL },
    license: { name: "MIT", identifier: "MIT" },
  },
  servers: [
    { url: PUBLIC_BASE_URL, description: "this instance" },
    { url: LOCAL_SERVER_URL, description: "local api" },
  ],
  tags: [
    { name: "system", description: "health, status, root" },
    { name: "explorer", description: "block / tx / address / receipt lookups" },
    { name: "debugger", description: "opcode-level trace + call-tree inspection" },
    { name: "simulate", description: "transaction + bundle simulation (read-only fork)" },
    { name: "testnets", description: "virtual testnets (Anvil forks: CRUD + lifecycle)" },
    { name: "alerts", description: "monitoring rules + history (CRUD + replay)" },
    { name: "actions", description: "serverless web3 actions + execution history" },
    { name: "source", description: "verified-source lookup + Sourcify proxy" },
    { name: "signatures", description: "4byte / Sourcify selector lookups" },
    { name: "diff", description: "contract source diff" },
    { name: "etherscan", description: "Etherscan v2 API shim — verifysourcecode, account, contract" },
    { name: "chifra", description: "TrueBlocks chifra appearance lookups" },
    { name: "gas", description: "gas estimation + history" },
    { name: "mempool", description: "pending-tx snapshots" },
    { name: "keys", description: "project API key CRUD" },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description:
          "Project API key from `POST /api/keys`. Required for `/api/*` routes except a small set of public lookups (the drift gate lists which).",
      },
    },
  },
  paths: {
    // ─────────────────────────────────────────────────────────────────
    // tag: system  (slice 1 starter — public, no auth)
    // ─────────────────────────────────────────────────────────────────
    "/health": {
      get: {
        tags: ["system"],
        summary: "Liveness probe + chain identity",
        description:
          "Probes Postgres and returns a `db` boolean alongside chain identity. " +
          "Returns 200 when `db: true`, 503 when degraded.",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Healthy.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok", "degraded"] },
                    chain: { type: "string" },
                    chainId: { type: "integer" },
                    db: { type: "boolean" },
                    chainsReady: {
                      type: "boolean",
                      description:
                        "Soft readiness: true once every configured chain's block window has warmed. Does not affect the HTTP status.",
                    },
                    chains: {
                      type: "array",
                      description: "Per-chain boot warm status for the launch set.",
                      items: {
                        type: "object",
                        properties: {
                          chainId: { type: "integer" },
                          name: { type: "string" },
                          state: {
                            type: "string",
                            enum: ["warming", "ready", "degraded"],
                          },
                          blocks: { type: "integer" },
                          rpcConfigured: { type: "boolean" },
                          error: { type: "string" },
                        },
                        required: [
                          "chainId",
                          "name",
                          "state",
                          "blocks",
                          "rpcConfigured",
                        ],
                      },
                    },
                  },
                  required: ["status", "chain", "chainId", "db"],
                },
              },
            },
          },
          "503": {
            description: "Database unreachable.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["degraded"] },
                    chain: { type: "string" },
                    chainId: { type: "integer" },
                    db: { type: "boolean", enum: [false] },
                  },
                  required: ["status", "chain", "chainId", "db"],
                },
              },
            },
          },
        },
      },
    },
  },
};
