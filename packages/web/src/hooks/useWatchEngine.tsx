import { useCallback, useState, type ReactNode } from "react";
import { ruleSignature } from "../lib/watcher/engine";
import { RuleWatcher } from "../components/watcher/RuleWatcher";
import { useWatchRules } from "./useWatchRules";
import { useWatchLog } from "./useWatchLog";
import type { WatchMatch, WatchMatchContent, WatchRule } from "../lib/watcher/types";

/**
 * The watcher's running heart. Mount it ONCE, app-wide (see WatchNotifications),
 * so watches stay live while the user browses anywhere. It renders one
 * `RuleWatcher` per enabled rule — each polls the backend REST endpoints (no raw
 * RPC) and reports new matches through `onMatch`, which appends to the activity
 * log and surfaces the freshly-persisted one for the toast.
 *
 * Returns `pollers` (the per-rule watcher elements) for the caller to render,
 * plus `latest` (the newest persisted match, or null).
 */
export function useWatchEngine(): { latest: WatchMatch | null; pollers: ReactNode } {
  const { rules } = useWatchRules();
  const { append } = useWatchLog();
  const [latest, setLatest] = useState<WatchMatch | null>(null);

  const onMatch = useCallback(
    (rule: WatchRule, content: WatchMatchContent) => {
      void append.mutateAsync({ rule, content }).then((m) => {
        if (m) setLatest(m);
      });
    },
    [append],
  );

  const pollers = rules
    .filter((r) => r.enabled)
    .map((rule) => (
      <RuleWatcher key={ruleSignature(rule)} rule={rule} onMatch={onMatch} />
    ));

  return { latest, pollers };
}
