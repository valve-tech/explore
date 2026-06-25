import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "./_test-utils";
import { WatchRulesPanel } from "../components/workspace/watcher/WatchRulesPanel";
import type { Workspace } from "../lib/workspace/types";
import type { WatchRule, WatchMatch } from "../lib/watcher/types";

/**
 * Per-workspace watcher panel — rules scoped to this workspace, an add toggle,
 * pause-all/resume-all, and the recent-activity feed. The IDB hooks and the
 * add-form child are mocked so the test owns the panel's filtering + actions.
 *
 * Real on-chain fixture (chain 369):
 *   WPLS https://scan.pulsechain.com/address/0xa1077a294dde1b09bb078844df40758a5d0f9a27
 */

const WPLS = "0xa1077a294dde1b09bb078844df40758a5d0f9a27";

const toggleMutate = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
const addMutateAsync = vi.hoisted(() => vi.fn(async () => {}));
const setWorkspaceEnabledMutate = vi.hoisted(() => vi.fn());
const rulesState = vi.hoisted(() => ({ rules: [] as WatchRule[] }));
const matchesState = vi.hoisted(() => ({ matches: [] as WatchMatch[] }));

vi.mock("../hooks/useWatchRules", () => ({
  useWatchRules: () => ({
    rules: rulesState.rules,
    toggle: { mutate: toggleMutate },
    remove: { mutate: removeMutate },
    add: { mutateAsync: addMutateAsync },
    setWorkspaceEnabled: { mutate: setWorkspaceEnabledMutate },
  }),
}));
vi.mock("../hooks/useWatchLog", () => ({
  useWatchLog: () => ({ matches: matchesState.matches }),
}));
vi.mock("../components/workspace/watcher/WatchRuleForm", () => ({
  WatchRuleForm: ({ onAdd, onCancel }: { onAdd: (i: unknown) => Promise<unknown>; onCancel: () => void }) => (
    <div data-testid="rule-form">
      <button onClick={() => void onAdd({ kind: "address_activity" })}>form-add</button>
      <button onClick={onCancel}>form-cancel</button>
    </div>
  ),
}));

function ws(): Workspace {
  return { id: "w1", name: "DeFi", createdAt: 1, updatedAt: 1, items: [] };
}

function rule(over: Partial<WatchRule> = {}): WatchRule {
  return {
    id: "r1",
    workspaceId: "w1",
    chainId: 369,
    kind: "address_activity",
    enabled: true,
    address: WPLS,
    direction: "both",
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  toggleMutate.mockClear();
  removeMutate.mockClear();
  addMutateAsync.mockClear();
  setWorkspaceEnabledMutate.mockClear();
  rulesState.rules = [];
  matchesState.matches = [];
});

describe("<WatchRulesPanel />", () => {
  it("shows the empty hint when the workspace has no rules", () => {
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    expect(screen.getByText(/client-side · tab-open/)).toBeInTheDocument();
    expect(screen.getByText(/Watch an address or token/)).toBeInTheDocument();
  });

  it("lists only this workspace's rules and the active count", () => {
    rulesState.rules = [
      rule({ id: "r1", label: "Treasury", enabled: true }),
      rule({ id: "r2", label: "Other ws", workspaceId: "w2" }),
      rule({ id: "r3", kind: "erc20_transfer", contractAddress: WPLS, address: undefined, enabled: false }),
    ];
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    expect(screen.getByText("Treasury")).toBeInTheDocument();
    expect(screen.queryByText("Other ws")).not.toBeInTheDocument(); // w2 filtered out
    expect(screen.getByText(/1 active · client-side/)).toBeInTheDocument();
    // chain badge symbol
    expect(screen.getAllByText("PLS").length).toBeGreaterThan(0);
  });

  it("toggles and removes a rule", () => {
    rulesState.rules = [rule({ id: "r1", label: "Treasury" })];
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    // RuleRow has two icon-only buttons in order: [toggle, remove].
    const row = screen.getByText("Treasury").closest("li") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    fireEvent.click(buttons[0]!);
    expect(toggleMutate).toHaveBeenCalledWith("r1");
    fireEvent.click(buttons[1]!);
    expect(removeMutate).toHaveBeenCalledWith("r1");
  });

  it("shows pause-all when >1 rule and any enabled; resume-all when all paused", () => {
    rulesState.rules = [rule({ id: "r1", enabled: true }), rule({ id: "r2", enabled: true })];
    const { rerender } = renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pause all/ }));
    expect(setWorkspaceEnabledMutate).toHaveBeenCalledWith({ workspaceId: "w1", enabled: false });

    rulesState.rules = [rule({ id: "r1", enabled: false }), rule({ id: "r2", enabled: false })];
    rerender(<WatchRulesPanel workspace={ws()} />);
    fireEvent.click(screen.getByRole("button", { name: /Resume all/ }));
    expect(setWorkspaceEnabledMutate).toHaveBeenCalledWith({ workspaceId: "w1", enabled: true });
  });

  it("opens the add form, adds via it, and toggles it closed", () => {
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(screen.getByTestId("rule-form")).toBeInTheDocument();
    fireEvent.click(screen.getByText("form-add"));
    expect(addMutateAsync).toHaveBeenCalledWith({ kind: "address_activity" });
    fireEvent.click(screen.getByText("form-cancel"));
    expect(screen.queryByTestId("rule-form")).not.toBeInTheDocument();
  });

  it("renders the recent-activity feed scoped to this workspace", () => {
    matchesState.matches = [
      {
        id: "m1",
        ruleId: "r1",
        workspaceId: "w1",
        chainId: 369,
        kind: "address_activity",
        label: "Treasury",
        at: Date.now(),
        lead: "Activity ",
        amount: null,
        trail: "moved",
        txHash: "0xfeed",
      },
      {
        id: "m2",
        ruleId: "r9",
        workspaceId: "w2", // other workspace → filtered out
        chainId: 369,
        kind: "address_activity",
        label: "x",
        at: Date.now(),
        lead: "other",
        amount: null,
        trail: "",
      },
    ];
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText(/Activity moved/)).toBeInTheDocument();
    expect(screen.queryByText("other")).not.toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument(); // timeAgo fresh
  });

  it("formats match times across the s/m/h/d branches", () => {
    const base = {
      ruleId: "r1",
      workspaceId: "w1",
      chainId: 369,
      kind: "address_activity" as const,
      label: "x",
      amount: null,
      trail: "",
    };
    matchesState.matches = [
      { ...base, id: "s", lead: "secs", at: Date.now() - 20_000 }, // 20s
      { ...base, id: "h", lead: "hours", at: Date.now() - 3 * 3_600_000 }, // 3h
      { ...base, id: "d", lead: "days", at: Date.now() - 2 * 86_400_000 }, // 2d
    ];
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    expect(screen.getByText("20s")).toBeInTheDocument();
    expect(screen.getByText("3h")).toBeInTheDocument();
    expect(screen.getByText("2d")).toBeInTheDocument();
  });

  it("renders a non-linked match summary when there's no tx hash", () => {
    matchesState.matches = [
      {
        id: "m1",
        ruleId: "r1",
        workspaceId: "w1",
        chainId: 369,
        kind: "erc20_transfer",
        label: "Token",
        at: Date.now() - 120_000, // 2m ago
        lead: "Transfer ",
        amount: null,
        trail: "seen",
      },
    ];
    renderWithProviders(<WatchRulesPanel workspace={ws()} />);
    const summary = screen.getByText(/Transfer seen/);
    expect(summary.closest("a")).toBeNull(); // no link without txHash
    expect(screen.getByText("2m")).toBeInTheDocument();
  });
});
