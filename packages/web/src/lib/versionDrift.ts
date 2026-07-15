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

/**
 * True when we should reload right now: drifted AND no in-flight work.
 * While busy we defer — the caller re-evaluates on its next poll.
 */
export function shouldReloadNow(
  served: string | null | undefined,
  baked: string,
  busy: boolean,
): boolean {
  return hasDrifted(served, baked) && !busy;
}
