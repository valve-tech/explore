import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { RuleWatcher } from "../components/watcher/RuleWatcher";
import type { WatchRule } from "../lib/watcher/types";
import type { RuleItem } from "../lib/watcher/engine";
import { ruleSignature } from "../lib/watcher/engine";

/**
 * RuleWatcher polls one rule and diffs poll results against a module-level
 * seen-set. The FIRST poll primes the baseline silently; only items that are
 * genuinely new on a LATER poll fire onMatch. The engine fetch is mocked so we
 * drive the new-vs-seen logic directly. Each test uses a distinct rule
 * signature (unique address) so the module-level seen/primed maps don't leak
 * across cases.
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const fetchRuleItems = vi.hoisted(() => vi.fn<(rule: WatchRule) => Promise<RuleItem[]>>());

vi.mock("../lib/watcher/engine", async (orig) => {
  const actual = await orig<typeof import("../lib/watcher/engine")>();
  return { ...actual, fetchRuleItems };
});

function rule(address: string): WatchRule {
  return {
    id: `r-${address}`,
    workspaceId: "w1",
    chainId: 369,
    kind: "address_activity",
    enabled: true,
    address,
    direction: "both",
    createdAt: 1,
  };
}

function item(key: string): RuleItem {
  return { key, contents: [{ lead: `tx ${key} `, amount: null, trail: "moved", txHash: `0x${key}` }] };
}

beforeEach(() => {
  fetchRuleItems.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("<RuleWatcher />", () => {
  it("primes the baseline on the first poll without firing onMatch", async () => {
    const onMatch = vi.fn();
    fetchRuleItems.mockResolvedValue([item("a"), item("b")]);
    renderWithProviders(<RuleWatcher rule={rule("0xprime1")} onMatch={onMatch} />);

    // Wait for the first query to resolve + the effect to run.
    await waitFor(() => expect(fetchRuleItems).toHaveBeenCalled());
    // First load establishes the seen-set; nothing replays.
    await new Promise((r) => setTimeout(r, 0));
    expect(onMatch).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    fetchRuleItems.mockResolvedValue([]);
    const { container } = renderWithProviders(
      <RuleWatcher rule={rule("0xrender")} onMatch={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not fire while the query has no data yet", async () => {
    const onMatch = vi.fn();
    // never resolves → query.data stays undefined → early return in the effect
    fetchRuleItems.mockReturnValue(new Promise<RuleItem[]>(() => {}));
    renderWithProviders(<RuleWatcher rule={rule("0xpending")} onMatch={onMatch} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(onMatch).not.toHaveBeenCalled();
  });

  it("fires onMatch only for genuinely-new items on a later poll", async () => {
    const onMatch = vi.fn();
    const r = rule("0xfire");
    const sig = ruleSignature(r);
    fetchRuleItems.mockResolvedValue([item("seen-1")]);

    const { queryClient } = renderWithProviders(
      <RuleWatcher rule={r} onMatch={onMatch} />,
    );
    // First poll primes the baseline (seen-1), no fire.
    await waitFor(() => expect(fetchRuleItems).toHaveBeenCalled());
    await new Promise((res) => setTimeout(res, 0));
    expect(onMatch).not.toHaveBeenCalled();

    // Simulate the next poll returning the old item + a new one.
    queryClient.setQueryData(["watch", sig], [item("seen-1"), item("new-2")]);

    await waitFor(() => expect(onMatch).toHaveBeenCalledTimes(1));
    const [firedRule, content] = onMatch.mock.calls[0]!;
    expect(firedRule.id).toBe(r.id);
    expect(content.txHash).toBe("0xnew-2"); // only the new item fired
  });
});
