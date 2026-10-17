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

import { createServer, type Server } from "node:http";
import app from "./app.js";
import { runMigrations } from "./services/migrate.js";
import { pool } from "./services/pool.js";
import { awaitPendingCacheWrites } from "./services/tracer.js";
import { forkManager } from "./services/forkManager.js";
import { startMonitor } from "./services/monitor.js";
import { initWebSocket } from "./services/wsServer.js";
import { warmAllChains } from "./services/networkHealth/warmup.js";

const PORT = Number(process.env.PORT) || 10100;

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
    console.log(`  CRUD /api/keys                 – API key management`);
    console.log(`  WS   /ws/alerts                – real-time alert notifications`);
    console.log(`  GET  /health                   – health check`);

    initWebSocket(server);
    startMonitor();
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
