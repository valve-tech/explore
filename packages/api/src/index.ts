import "./env.js"; // must be first — loads root .env before services read process.env

// tsx watch re-runs modules on file change without tearing down the previous
// instance's process listeners, so SIGINT/SIGTERM/exit handlers accumulate
// across reloads (3 per reload from forkManager + 2 from gracefulShutdown).
// After a few saves we trip Node's default 10-listener "possible memory leak"
// warning. Raise the ceiling — in production there's no hot reload so the
// long-term count is bounded.
if (process.env.NODE_ENV !== "production") {
  process.setMaxListeners(50);
}

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { runMigrations } from "./services/migrate.js";
import { checkHealth, pool } from "./services/pool.js";
import { getBuildInfo } from "./lib/buildInfo.js";
import { awaitPendingCacheWrites } from "./services/tracer.js";
import { forkManager } from "./services/forkManager.js";
import simulateRouter from "./routes/simulate.js";
import simulateBundleRouter from "./routes/simulateBundle.js";
import explorerRouter from "./routes/explorer.js";
import latestRouter from "./routes/latest.js";
import testnetsRouter from "./routes/testnets.js";
import alertsRouter from "./routes/alerts.js";
import debuggerRouter from "./routes/debugger.js";
import actionsRouter from "./routes/actions.js";
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
import { authMiddleware } from "./middleware/auth.js";
import { chainContext } from "./middleware/chainContext.js";
import { strictChainId } from "./middleware/strictChainId.js";
import { corsDelegate } from "./lib/cors.js";
import { docsHandler, openapiJsonHandler } from "./openapi/handlers.js";
import { startMonitor } from "./services/monitor.js";
import { initScheduler } from "./services/actionScheduler.js";
import { initWebSocket } from "./services/wsServer.js";
import { startNonceVacuum, runVacuumOnce } from "./services/auth/nonceVacuum.js";
import {
  warmAllChains,
  getChainWarmStatus,
  allChainsReady,
} from "./services/networkHealth/warmup.js";

const app = express();
const PORT = Number(process.env.PORT) || 10100;

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
app.use("/api/actions", actionsRouter);
app.use("/api/source", sourceRouter);
app.use("/api/signatures", signaturesRouter);
app.use("/api/keys", apiKeysRouter);
app.use("/api/auth", authRouter);
app.use("/api/workspaces", workspaceSyncRouter);
app.use("/api/portfolio", portfolioRouter);
app.use("/api/resolve", resolveRouter);
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

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[unhandled]", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  },
);

// ---------------------------------------------------------------------------
// Start — run migrations then listen
// ---------------------------------------------------------------------------

/**
 * Drain in-flight work and tear down owned resources, then exit. Sequence:
 *   1. Close the HTTP server (stop accepting new connections; keep existing
 *      ones until they complete or timeout).
 *   2. Await pending trace-cache writes — the tracer batches Postgres
 *      inserts, and a hard kill loses the batch.
 *   3. End the pg Pool — closes idle connections cleanly.
 *   4. Tear down every Anvil fork.
 *
 * The hard cap (FORCE_EXIT_MS) guarantees the process exits even if a
 * step hangs; without it, a stuck pg query would block container restarts.
 * The `shuttingDown` guard makes signal-flood safe — a second SIGTERM
 * during shutdown is ignored rather than re-entering.
 */
const FORCE_EXIT_MS = 15_000;
let shuttingDown = false;

async function gracefulShutdown(server: Server, signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal} — draining…`);

  // Belt-and-braces hard timeout: if any step hangs, abort.
  const forceExit = setTimeout(() => {
    console.error(`[shutdown] timed out after ${FORCE_EXIT_MS}ms — forcing exit`);
    process.exit(1);
  }, FORCE_EXIT_MS);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await awaitPendingCacheWrites();
    await pool.end();
    forkManager.cleanupAll();
    console.log("[shutdown] clean exit");
    process.exit(0);
  } catch (err) {
    console.error("[shutdown] error during drain:", err);
    process.exit(1);
  }
}

async function start(): Promise<void> {
  await runMigrations();

  const server = createServer(app);

  // Let the API orchestrate process exit; ForkManager still cleans up its
  // children but no longer races us to `process.exit(0)` on signals.
  forkManager.setExitOnSignal(false);

  server.listen(PORT, () => {
    console.log(`Explore API listening on http://localhost:${PORT}`);
    console.log(`  POST /api/simulate            – single transaction simulation`);
    console.log(`  POST /api/simulate-bundle      – bundled transaction simulation`);
    console.log(`  GET  /api/tx/:hash             – transaction details`);
    console.log(`  GET  /api/address/:addr         – address info`);
    console.log(`  POST /api/testnets             – create virtual testnet`);
    console.log(`  CRUD /api/alerts               – monitoring & alert rules`);
    console.log(`  GET  /api/debug/tx/:hash/trace – call tree trace`);
    console.log(`  CRUD /api/actions              – web3 actions`);
    console.log(`  CRUD /api/keys                 – API key management`);
    console.log(`  WS   /ws/alerts                – real-time alert notifications`);
    console.log(`  GET  /health                   – health check`);

    initWebSocket(server);
    startMonitor();
    void initScheduler();
    // Sweep on boot to clear anything stranded across the last restart, then
    // schedule the hourly worker. Boot sweep is fire-and-forget — the table
    // is small enough that even a cold restart finishes in milliseconds.
    void runVacuumOnce();
    startNonceVacuum();
    // Best-effort, non-blocking warm of every launch-set chain's block window.
    // Fast first paint + an immediate per-chain RPC health signal in /health.
    // A chain that can't warm is marked degraded, never fatal (see warmup.ts).
    warmAllChains();
  });

  process.on("SIGTERM", () => void gracefulShutdown(server, "SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown(server, "SIGINT"));
}

start().catch((err) => {
  console.error("[startup] fatal error:", err);
  process.exit(1);
});

export default app;
