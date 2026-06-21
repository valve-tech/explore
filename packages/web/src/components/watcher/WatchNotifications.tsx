import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWatchEngine } from "../../hooks/useWatchEngine";
import AlertToast from "../AlertToast";
import { showDesktopNotification } from "../../lib/watcher/desktopNotify";
import { deepLinkForMatch } from "../../lib/watcher/deepLink";
import { renderWatchSummary } from "../../lib/watcher/summary";
import type { WatchMatch } from "../../lib/watcher/types";

/**
 * App-level mount point for the client-side watcher. Rendering this once (in
 * App) is what keeps watches live across the whole app — `useWatchEngine`
 * returns one `RuleWatcher` per enabled rule (each polling the backend REST
 * endpoints, no raw RPC), which we render here, decoupled from any single page.
 * When a watch fires we surface it as an ambient toast (reusing the `AlertToast` the
 * server-side monitor uses, for visual consistency); the actionable, clickable
 * record lives in the workspace's activity log.
 *
 * Toast lifecycle mirrors App's existing alert toast: show on a NEW match
 * (deduped by id), auto-dismiss after 6s, re-key so each match slides in fresh.
 * A new match also raises an optional desktop notification — a no-op unless the
 * user enabled it AND granted browser permission (see `desktopNotify`), so the
 * backgrounded-tab case is covered without changing the always-on toast.
 */
export default function WatchNotifications() {
  const { latest, pollers } = useWatchEngine();
  const navigate = useNavigate();
  const [toast, setToast] = useState<WatchMatch | null>(null);
  const seenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (latest === null || latest.id === seenRef.current) return;
    seenRef.current = latest.id;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setToast(latest);
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, 6_000);
    showDesktopNotification({
      title: latest.label,
      body: renderWatchSummary(latest),
      tag: latest.id,
      // Click the OS notification → focus this tab and route to the match.
      // `navigate` (not window.location) keeps it correct under both the
      // path-based and hash-based router builds.
      onClick: () => navigate(deepLinkForMatch(latest)),
    });
  }, [latest, navigate]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <>
      {pollers}
      {toast !== null && (
        <AlertToast
          key={toast.id}
          alert={{ name: toast.label, type: toast.kind }}
          match={{ summary: renderWatchSummary(toast) }}
        />
      )}
    </>
  );
}
