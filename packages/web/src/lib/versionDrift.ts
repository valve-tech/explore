/**
 * Pure decisions for "this tab is running an older build than the server".
 *
 * Both shas must be known for drift to count: an unstamped build ("unknown")
 * or a missing /health payload means we cannot tell, and guessing would
 * reload the tab forever.
 */
const UNKNOWN = "unknown";

function isKnown(sha: string | null | undefined): sha is string {
  return typeof sha === "string" && sha.length > 0 && sha !== UNKNOWN;
}

/** True when the server reports a different build than this bundle. */
export function hasDrifted(served: string | null | undefined, baked: string): boolean {
  if (!isKnown(served) || !isKnown(baked)) return false;
  return served !== baked;
}

const RELOADED_SHA_KEY = "explore:versionDrift:reloadedForSha";

/** The slice of the Storage interface `claimReload` needs — narrow so tests can fake it easily. */
export type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Decide whether a stale tab should reload for `servedSha`, and if it should,
 * record that it has — so the SAME served sha never triggers a second reload.
 *
 * This bounds the auto-reload. The API resolves its build sha at runtime
 * (process start) while the web bakes its sha at build time, so the two can
 * disagree *persistently* — e.g. a `git pull` + API restart with no matching
 * web rebuild. Without this guard: tab loads the stale bundle, the poller
 * sees drift, reloads, loads the same stale bundle, sees drift again —
 * forever, in every open tab, with no kill switch.
 *
 * Guards the whole sessionStorage interaction in one try/catch: it throws in
 * some privacy modes / sandboxed iframes. A storage failure must never crash
 * the app or the poller — fail safe by NOT reloading (a missed reload is a
 * nuisance; an infinite reload loop makes the site unusable).
 */
export function claimReload(servedSha: string, storage: MinimalStorage): boolean {
  try {
    if (storage.getItem(RELOADED_SHA_KEY) === servedSha) return false;
    storage.setItem(RELOADED_SHA_KEY, servedSha);
    return true;
  } catch {
    return false;
  }
}
