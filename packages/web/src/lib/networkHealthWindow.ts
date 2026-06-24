/**
 * Single source of truth for network-health window sizing on the frontend.
 *
 * The selectable windows, the default, and the ceiling all live here so the
 * picker (`WindowSelector`), the page's initial state (`NetworkHealthPage`), and
 * the BYO-RPC streaming path (`byoNetworkHealth`) can never drift out of sync.
 *
 * MAX_WINDOW must equal the API's `MAX_LIMIT`
 * (packages/api/src/services/networkHealth/cache.ts) — the backend rejects
 * larger windows, and the BYO path clamps to the same ceiling. DEFAULT_WINDOW
 * mirrors the API's `INITIAL_WINDOW` (the cheap cold-load size).
 */

/** Selectable block-window sizes, ascending. */
export const WINDOW_OPTIONS = [64, 256, 512, 1024, 2048] as const;

/** Cheap cold-load default (smallest option) — mirrors the API INITIAL_WINDOW. */
export const DEFAULT_WINDOW = Math.min(...WINDOW_OPTIONS);

/** Largest window a client may request — must match the API MAX_LIMIT. */
export const MAX_WINDOW = Math.max(...WINDOW_OPTIONS);

/**
 * BYO-RPC streaming: blocks fetched and painted per round (newest-first), so a
 * wide window fills in progressively instead of resolving all at once.
 */
export const STREAM_CHUNK = 64;
