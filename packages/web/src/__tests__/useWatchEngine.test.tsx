import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, render, act, waitFor } from "@testing-library/react";

/**
 * useWatchEngine — renders one RuleWatcher per ENABLED rule and surfaces the
 * newest persisted match for the toast. We mock the two composed hooks
 * (useWatchRules, useWatchLog), the engine's ruleSignature, and RuleWatcher
 * (so we can invoke its onMatch directly). Asserts only enabled rules produce
 * pollers and that a successful append sets `latest`.
 */

const append = { mutateAsync: vi.fn() };
const useWatchRules = vi.fn();
const useWatchLog = vi.fn(() => ({ append }));

vi.mock("../hooks/useWatchRules", () => ({
  useWatchRules: () => useWatchRules(),
}));
vi.mock("../hooks/useWatchLog", () => ({
  useWatchLog: () => useWatchLog(),
}));
vi.mock("../lib/watcher/engine", () => ({
  ruleSignature: (r: { id: string }) => `sig-${r.id}`,
}));

// Capture onMatch from each RuleWatcher render so we can drive a match.
const capturedOnMatch: Array<(rule: unknown, content: unknown) => void> = [];
vi.mock("../components/watcher/RuleWatcher", () => ({
  RuleWatcher: (props: {
    rule: { id: string };
    onMatch: (rule: unknown, content: unknown) => void;
  }) => {
    capturedOnMatch.push(props.onMatch);
    return null;
  },
}));

import { useWatchEngine } from "../hooks/useWatchEngine";
import { isValidElement } from "react";

const enabledRule = {
  id: "r1",
  workspaceId: "ws1",
  chainId: 369,
  kind: "address_activity" as const,
  enabled: true,
  createdAt: 1,
};
const disabledRule = { ...enabledRule, id: "r2", enabled: false };
const CONTENT = { lead: "x", amount: null, trail: "y" };
const MATCH = { ...CONTENT, id: "m1", ruleId: "r1" };

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnMatch.length = 0;
  append.mutateAsync.mockResolvedValue(MATCH);
});

describe("useWatchEngine", () => {
  it("renders a poller only for each enabled rule", () => {
    useWatchRules.mockReturnValue({ rules: [enabledRule, disabledRule] });
    const { result } = renderHook(() => useWatchEngine());
    const pollers = result.current.pollers as React.ReactNode[];
    expect(Array.isArray(pollers)).toBe(true);
    expect(pollers).toHaveLength(1);
    expect(isValidElement(pollers[0])).toBe(true);
  });

  it("starts with no latest match", () => {
    useWatchRules.mockReturnValue({ rules: [] });
    const { result } = renderHook(() => useWatchEngine());
    expect(result.current.latest).toBeNull();
    expect(result.current.pollers).toEqual([]);
  });

  it("onMatch appends and surfaces the persisted match as latest", async () => {
    useWatchRules.mockReturnValue({ rules: [enabledRule] });
    const seen: { latest: unknown } = { latest: undefined };

    function Harness() {
      const { latest, pollers } = useWatchEngine();
      seen.latest = latest;
      return <>{pollers}</>;
    }
    render(<Harness />);

    // Rendering the pollers mounts the (mocked) RuleWatcher, capturing onMatch.
    expect(capturedOnMatch).toHaveLength(1);
    await act(async () => {
      capturedOnMatch[0]!(enabledRule, CONTENT);
    });
    expect(append.mutateAsync).toHaveBeenCalledWith({
      rule: enabledRule,
      content: CONTENT,
    });
    await waitFor(() => expect(seen.latest).toEqual(MATCH));
  });

  it("does not set latest when append dedupes (returns null)", async () => {
    append.mutateAsync.mockResolvedValue(null);
    useWatchRules.mockReturnValue({ rules: [enabledRule] });
    const seen: { latest: unknown } = { latest: undefined };

    function Harness() {
      const { latest, pollers } = useWatchEngine();
      seen.latest = latest;
      return <>{pollers}</>;
    }
    render(<Harness />);

    await act(async () => {
      capturedOnMatch[0]!(enabledRule, CONTENT);
    });
    expect(seen.latest).toBeNull();
  });
});
