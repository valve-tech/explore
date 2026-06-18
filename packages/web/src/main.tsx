import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { WagmiProvider } from "wagmi";
import { createIdbPersister } from "./lib/idbPersister";
import { wagmiConfig } from "./lib/wagmi";
import App from "./App";
import "./index.css";

// wagmi v2 uses module augmentation for chain-id literal narrowing across
// hooks. Registering the config here means `useChainId()` returns
// `1 | 369 | 943`, not the loose `number` fallback.
declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

// Dual-build router. The canonical explore.valve.city build uses BrowserRouter
// for EIP-3091 URLs (/tx/0xabc). The IPFS build uses HashRouter (/#/tx/0xabc)
// because public gateways don't rewrite paths and relative `base: "./"` is only
// safe when the document path stays at root. VITE_IPFS picks the build.
const isIpfsBuild = import.meta.env.VITE_IPFS === "1";
const Router = isIpfsBuild ? HashRouter : BrowserRouter;

// Canonical build only: one-time HashRouter → BrowserRouter rewrite, so old
// /#/foo bookmarks from before the EIP-3091 migration still resolve. Skipped
// on the IPFS build, which deliberately serves hash routes.
if (!isIpfsBuild && window.location.hash.startsWith("#/")) {
  const newPath = window.location.hash.slice(1) + window.location.search;
  window.history.replaceState(null, "", newPath);
}

/**
 * HTTP status embedded in our thrown error messages (api/* throw
 * `new Error("… HTTP 429")`). Lets the retry policy refuse to hammer on a
 * rate-limit / client error instead of retrying it blind.
 */
function statusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const m = error.message.match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      // Never retry immediately on an error — that's exactly how a rate-limited
      // or slow upstream turns one failure into hundreds of requests/sec. A
      // 429 or any 4xx is terminal (no retry at all); transient 5xx / network
      // errors get at most two attempts, each on an exponential, capped backoff.
      retry: (failureCount, error) => {
        const status = statusFromError(error);
        if (status === 429 || (status !== null && status < 500)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
    },
  },
});

const persister = createIdbPersister();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
    <PersistQueryClientProvider
      client={queryClient}
      // `buster` discards the persisted cache when bumped. Bump it whenever a
      // backend change alters a long-cached response shape — e.g. the solc-js
      // source-map fix flipped `hasSourceMap` for already-viewed contracts that
      // were cached false under `staleTime: Infinity`. 2026-05-26: the opcode
      // trace switched to the full skeleton (~111k steps vs an old truncated
      // ~50k), and contract-meta gained an events map — both long-cached under
      // staleTime Infinity, so old clients kept serving the stale trace + tree.
      // 2026-05-30: contract-meta switched to retry-then-omit (sparse records
      // on transient upstream failures). Old persisted entries from the
      // Blockscout outage held empty records that staleTime: Infinity pinned
      // forever, masking method names across reloads.
      // 2026-05-31: useTraceSources got the same retry-then-omit treatment
      // (queryKey bumped to `v2`). Old v1 entries held 0-file results from
      // pre-fix sessions that starved the debugger's call-tree fnIndex of
      // every contract's source — silently masking the call-site override.
      // 2026-06-01: staleTime: Infinity hygiene sweep across the rest of
      // the long-cached queries — useTraceSourceMaps, useSignatures, and
      // useContractSource all gained retry-then-omit (or retry-then-throw)
      // semantics and bumped to v2 keys. Old v1 entries from prior outages
      // held empty mappings / no-match results that pinned the debugger
      // call tree's source-map and method-name layers across reloads.
      // 2026-06-15: network-health responses gained `miners` (per-validator
      // rollup); old persisted entries lacked it and crashed the miners panel.
      persistOptions={{ persister, maxAge: Infinity, buster: "2026-06-15-network-health-miners" }}
    >
      <Router>
        <App />
      </Router>
    </PersistQueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
