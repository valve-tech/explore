import { useEffect, useState } from "react";
import { BUILD_INFO } from "../lib/buildInfo";
import { claimReload, hasDrifted } from "../lib/versionDrift";

/** How long a drifted tab waits before it is eligible to reload. */
export const RELOAD_DELAY_MS = 5_000;

/**
 * Auto-reload a stale tab once the deployed build moves ahead of this bundle.
 *
 * The delay is keyed on `drifted` alone — deliberately NOT on `busy`. Routes
 * that poll (Landing, Explorer, Mempool all refetch every 5s) flip `busy` on a
 * cadence at or below the delay; including `busy` here would cancel and restart
 * the timer forever and the reload would never fire on exactly the dashboards
 * this exists for. Instead the timer arms a latch, and the reload happens at the
 * first idle instant after that — so in-flight work is still never interrupted.
 *
 * `busy` is passed in rather than read here so this hook is testable without a
 * QueryClientProvider.
 *
 * The actual reload is bounded by `claimReload` (see lib/versionDrift.ts): at
 * most one reload per observed server sha, tracked in sessionStorage, so a
 * server/bundle sha mismatch that never clears (e.g. an API restart without a
 * matching web rebuild) can't loop this tab forever.
 */
export function useVersionDriftReload(servedSha: string | null, busy: boolean): void {
  const drifted = hasDrifted(servedSha, BUILD_INFO.sha);
  const [reloadArmed, setReloadArmed] = useState(false);

  useEffect(() => {
    // Reset the latch whenever drift status changes, so a stale `true` from an
    // earlier drift cycle can't fire an instant reload that skips the delay.
    setReloadArmed(false);
    if (!drifted) return;
    const timer = setTimeout(() => setReloadArmed(true), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [drifted]);

  useEffect(() => {
    if (!reloadArmed || busy || !servedSha) return;
    if (claimReload(servedSha, window.sessionStorage)) window.location.reload();
  }, [reloadArmed, busy, servedSha]);
}
