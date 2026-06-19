/**
 * The feature catalogue, grouped by intent. Single source of truth for both
 * the sidebar (AppShell) and the landing hub. The hints double as section
 * copy on the landing page; the per-item `desc` is shown on the feature cards.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  desc: string;
}

export interface NavGroup {
  label: string;
  hint: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Inspect",
    hint: "Look at something that already happened",
    items: [
      {
        to: "/explorer",
        label: "Explorer",
        icon: "heroicons:magnifying-glass",
        desc: "Blocks, transactions, addresses, and verified contracts.",
      },
      {
        to: "/mempool",
        label: "Mempool",
        icon: "heroicons:queue-list",
        desc: "Pending transactions in node inclusion order.",
      },
      {
        to: "/network-health",
        label: "Network Health",
        icon: "heroicons:chart-bar",
        desc: "Tx prioritization, fee burn, and mining-order health.",
      },
      {
        to: "/debugger",
        label: "Debugger",
        icon: "heroicons:bug-ant",
        desc: "Step opcodes, walk the call tree, profile gas.",
      },
      {
        to: "/storage",
        label: "Storage",
        icon: "heroicons:rectangle-stack",
        desc: "Inspect a contract's storage layout and slots.",
      },
      {
        to: "/diff",
        label: "Contract Diff",
        icon: "heroicons:document-duplicate",
        desc: "Compare two contracts' verified source.",
      },
      {
        to: "/verify",
        label: "Verify",
        icon: "heroicons:check-badge",
        desc: "Verify a contract's source via Sourcify.",
      },
    ],
  },
  {
    label: "Simulate",
    hint: "Try something before you broadcast",
    items: [
      {
        to: "/simulate",
        label: "Simulate",
        icon: "heroicons:play-circle",
        desc: "Run a transaction without broadcasting it.",
      },
      {
        to: "/fork",
        label: "Fork Sim",
        icon: "heroicons:arrows-right-left",
        desc: "Simulate from a forked chain state.",
      },
      {
        to: "/build",
        label: "Build Tx",
        icon: "heroicons:wrench-screwdriver",
        desc: "Construct a transaction by hand.",
      },
      {
        to: "/bundle",
        label: "Bundle",
        icon: "heroicons:queue-list",
        desc: "Simulate several transactions together.",
      },
      {
        to: "/testnets",
        label: "TestNets",
        icon: "heroicons:beaker",
        desc: "Spin up disposable Anvil fork testnets.",
      },
    ],
  },
  {
    label: "Investigate",
    hint: "Keep a named bucket of things you're digging into",
    items: [
      {
        to: "/workspace",
        label: "Workspaces",
        icon: "heroicons:folder",
        desc: "Named buckets of addresses, transactions, and blocks you're tracking together.",
      },
    ],
  },
  {
    label: "Automate",
    hint: "Keep something running in the background",
    items: [
      {
        to: "/monitoring",
        label: "Monitoring",
        icon: "heroicons:bell-alert",
        desc: "Alert on addresses, events, balances, and failures.",
      },
      {
        to: "/actions",
        label: "Actions",
        icon: "heroicons:bolt",
        desc: "Serverless Web3 functions on chain triggers.",
      },
    ],
  },
];
