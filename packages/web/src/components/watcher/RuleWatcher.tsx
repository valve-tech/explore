import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRuleItems, ruleSignature } from "../../lib/watcher/engine";
import type { WatchMatchContent, WatchRule } from "../../lib/watcher/types";

/**
 * One enabled watch rule, polled against the backend REST endpoints by default,
 * or straight from the user's node when a per-chain RPC override is set (the
 * transport choice lives in `engine.ts`). Each poll's results are diffed against
 * what we've already seen for this rule; only genuinely-new items fire `onMatch`.
 * The FIRST successful poll primes the seen-set without emitting,
 * so opening the app doesn't replay the last 24h of history as fresh alerts.
 *
 * Rendered once per enabled rule by the engine; renders nothing itself.
 */

const POLL_MS = 15_000;

// Module-level so they survive re-renders/remounts. Keyed by rule signature,
// which encodes chainId + the watched target, so two rules never collide and a
// toggled-off→on rule keeps its history (no re-flood).
const seenByRule = new Map<string, Set<string>>();
const primedRules = new Set<string>();

export function RuleWatcher({
  rule,
  onMatch,
}: {
  rule: WatchRule;
  onMatch: (rule: WatchRule, content: WatchMatchContent) => void;
}) {
  const sig = ruleSignature(rule);
  const query = useQuery({
    queryKey: ["watch", sig],
    queryFn: () => fetchRuleItems(rule),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
  });

  const items = query.data;
  useEffect(() => {
    if (!items) return;
    let seen = seenByRule.get(sig);
    if (!seen) {
      seen = new Set<string>();
      seenByRule.set(sig, seen);
    }
    const fresh = items.filter((it) => !seen!.has(it.key));
    for (const it of fresh) seen.add(it.key);

    // First load just establishes the baseline — don't replay history.
    if (!primedRules.has(sig)) {
      primedRules.add(sig);
      return;
    }
    for (const it of fresh) {
      for (const content of it.contents) onMatch(rule, content);
    }
  }, [items, sig, rule, onMatch]);

  return null;
}
