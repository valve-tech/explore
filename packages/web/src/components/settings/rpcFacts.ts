/**
 * The facts behind the settings controls. The page shows the controls and
 * keeps these lines behind the info button.
 */

/** What a chain RPC endpoint is, and what we can and cannot check. */
export const RPC_FACTS: string[] = [
  "This is where your browser sends its own chain calls: a transaction, an address's balance and code, a block, and anything your connected wallet needs.",
  "Explore's enriched reads (charts, debugger traces, source, decompile) always go through our backend. They never appear here.",
  "The default is Valve's own public node. Clear a field to return to it.",
  "Valve states it keeps no request logs and no client IP addresses.",
  "The other endpoints come from the chainlist dataset. We make no claim about their logging or uptime.",
  "We can check whether an endpoint serves history. Test asks each one for state at block 1. Most public endpoints answer for recent blocks only. This app reads old blocks all the time, so those endpoints fail here.",
  "Point a chain at your own node to depend on nobody.",
  "An endpoint you set must allow browser requests (CORS).",
  "Reload after a change. Explorer reads use the new URL on the next fetch. Your wallet's transport is built once at load, so only a reload moves it.",
];

/** What the backend origin override does. */
export const BACKEND_FACTS: string[] = [
  "This overrides the backend this UI talks to. You need it when an IPFS gateway serves the app and it must point at a chosen backend.",
  "Only http(s) origins are accepted. The value is stored in this browser only.",
  "Reload the page for a change to take effect. The app resolves the backend origin once, when it loads.",
];
