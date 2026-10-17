import "./env.js"; // must be first — loads root .env before services read process.env

// The Express app, built with no side effects beyond module load: no
// migrations, no listen, no monitor. src/index.ts starts it; tests mount it.

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { checkHealth } from "./services/pool.js";
import { getBuildInfo } from "./lib/buildInfo.js";
import simulateRouter from "./routes/simulate.js";
import simulateBundleRouter from "./routes/simulateBundle.js";
import explorerRouter from "./routes/explorer.js";
import latestRouter from "./routes/latest.js";
import testnetsRouter from "./routes/testnets.js";
import alertsRouter from "./routes/alerts.js";
import debuggerRouter from "./routes/debugger.js";
import sourceRouter from "./routes/source.js";
import forkSimulateRouter from "./routes/forkSimulate.js";
import signaturesRouter from "./routes/signatures.js";
import apiKeysRouter from "./routes/apiKeys.js";
import diffRouter from "./routes/diff.js";
import gasRouter from "./routes/gas.js";
import networkHealthRouter from "./routes/networkHealth.js";
import mempoolRouter from "./routes/mempool.js";
import chifraRouter from "./routes/chifra.js";
import etherscanRouter from "./routes/etherscan.js";
import authRouter from "./routes/auth.js";
import workspaceSyncRouter from "./routes/workspaceSync.js";
import portfolioRouter from "./routes/portfolio.js";
import resolveRouter from "./routes/resolve.js";
import multichainRouter from "./routes/multichain/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { chainContext } from "./middleware/chainContext.js";
import { strictChainId } from "./middleware/strictChainId.js";
import { corsDelegate } from "./lib/cors.js";
import { errorHandler } from "./lib/errorHandler.js";
import { docsHandler, openapiJsonHandler } from "./openapi/handlers.js";
import {
  getChainWarmStatus,
  allChainsReady,
} from "./services/networkHealth/warmup.js";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Split CORS: open read-only for any origin; credentialed only for the
// CREDENTIALED_ORIGINS allowlist (so a gateway-served frontend can do
// cookie-bearing auth + workspace sync). See lib/cors.ts.
app.use(cors(corsDelegate));
app.use(express.json({ limit: "2mb" }));

// Resolve the request's target chain from ?chainid (or a chainid body field)
// and run the rest of the request inside the chain context, so every chain-aware
// service routes to the right per-chain valve RPC endpoint. Mounted ahead of the
// /api routes; omitted/bad chainid falls back to the default chain (369).
app.use("/api", chainContext);

// ---------------------------------------------------------------------------
// Routes — health bypasses auth
// ---------------------------------------------------------------------------

app.get("/health", async (_req, res) => {
  const dbOk = await checkHealth();
  // Liveness is gated on the DB only — a single chain's RPC being down (or
  // unconfigured) is surfaced per-chain in `chains` and via `chainsReady`
  // without flipping the HTTP status, so one chain's outage can't restart-loop
  // the whole API. `chainsReady` is a soft readiness signal a deploy can poll.
  const chains = getChainWarmStatus();
  const status = dbOk ? "ok" : "degraded";
  res.status(dbOk ? 200 : 503).json({
    status,
    chain: "PulseChain",
    chainId: 369,
    db: dbOk,
    chainsReady: allChainsReady(),
    chains,
    version: getBuildInfo(),
  });
});

// OpenAPI federation surface — public, no auth, CORS open on the JSON.
// Federated from one.valve.city's root manifest at services[0].docs.openapi.
// See packages/api/src/openapi/spec.ts for the design.
app.get("/openapi.json", openapiJsonHandler);
app.get("/docs", docsHandler);

// ---------------------------------------------------------------------------
// Auth middleware — applied to all /api/* routes below
// ---------------------------------------------------------------------------

app.use("/api", authMiddleware);

// Reject a malformed/unsupported `chainid` on the REST sub-path surface with a
// 400 (the bare-/api Etherscan dispatcher is skipped — it validates itself).
// `chainContext` above has already bound the request to a chain; this only
// hardens the read routes that don't validate `chainid` for themselves.
app.use("/api", strictChainId);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.use("/api/simulate", simulateRouter);
app.use("/api/simulate", forkSimulateRouter);
app.use("/api/simulate-bundle", simulateBundleRouter);
app.use("/api", explorerRouter);
app.use("/api", latestRouter);
app.use("/api/testnets", testnetsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/debug", debuggerRouter);
app.use("/api/source", sourceRouter);
app.use("/api/signatures", signaturesRouter);
app.use("/api/keys", apiKeysRouter);
app.use("/api/auth", authRouter);
app.use("/api/workspaces", workspaceSyncRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/resolve", resolveRouter);
app.use("/api/multichain", multichainRouter);
app.use("/api/diff", diffRouter);
app.use("/api", chifraRouter);
app.use("/api/gas", gasRouter);
app.use("/api/network-health", networkHealthRouter);
app.use("/api/mempool", mempoolRouter);

// Etherscan-shaped dispatcher at the bare /api root. Matches GET/POST /api
// with a `module` + `action` query/body — handlers under routes/etherscan/
// reuse the same service functions as the REST routes above, so the two
// surfaces stay in sync without duplication. Mounted last because the
// bare-root path can't collide with any of the /api/* prefixes above.
app.use("/api", etherscanRouter);

// ---------------------------------------------------------------------------
// Static frontend — when packages/web/dist exists (production / Docker build),
// serve it from the root path. Browser refreshes inside the SPA's React Router
// routes (e.g. /debugger/0xabc) are caught by the fallback below.
// In dev (no dist directory), this is a no-op and the Vite dev server handles
// the web on its own port (11800).
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.join(__dirname, "..", "..", "web", "dist");

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));

  // SPA fallback. Excludes the JSON surfaces so genuine API 404s are returned
  // as JSON instead of being masked by index.html.
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path === "/health" ||
      req.path.startsWith("/ws")
    ) {
      return next();
    }
    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------

app.use(errorHandler);

export default app;
