import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import { StatusBadge } from "../primitives/StatusBadge";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type Outcome =
  | { kind: "revert"; reason: string; topAction: "swap" | "transfer" | "approve" }
  | { kind: "success"; topAction: "swap" | "transfer" | "approve" };

type Stage = { key: string; label: string; done: boolean; current?: boolean };

type Lens = { key: string; title: string; icon: string; body: ReactNode };

type NextStep = {
  label: string;
  sub: string;
  icon: string;
  primary?: boolean;
};

/* ------------------------------------------------------------------ */
/* The adaptive rail — domain logic                                   */
/* ------------------------------------------------------------------ */

/**
 * Maps a tx outcome to the ordered list of "what to do next" steps.
 *
 * The order encodes a hypothesis about user intent. Currently it leans
 * "diagnostic first" for reverts and "verify + automate" for successes,
 * but this is the single most important thing to revisit once we see
 * real usage. Each branch is independent — swapping rules for one
 * outcome won't disturb the others.
 */
function nextStepsFor(o: Outcome): NextStep[] {
  if (o.kind === "revert") {
    if (o.reason.includes("TRANSFER_FROM_FAILED")) {
      return [
        {
          primary: true,
          icon: "heroicons:bug-ant",
          label: "Step through the revert in the opcode debugger",
          sub: "We caught the REVERT at PC 4218 inside transferFrom",
        },
        {
          icon: "heroicons:shield-check",
          label: "Check token allowance on the source address",
          sub: "TRANSFER_FROM_FAILED is usually missing approval",
        },
        {
          icon: "heroicons:arrow-path",
          label: "Re-simulate with stateOverride: approval = MAX",
          sub: "Confirm the fix would have worked without re-running on-chain",
        },
        {
          icon: "heroicons:bell-alert",
          label: "Pin this address for a future failure alert",
          sub: "Catch the next failure before the user reports it",
        },
      ];
    }
    // Default revert ordering (other reasons)
    return [
      {
        primary: true,
        icon: "heroicons:bug-ant",
        label: "Step through the revert in the opcode debugger",
        sub: "Find the exact PC where execution stopped",
      },
      {
        icon: "heroicons:arrow-path",
        label: "Re-simulate with state overrides",
        sub: "Test a hypothesis without spending gas",
      },
      {
        icon: "heroicons:bell-alert",
        label: "Pin this contract for a future failure alert",
        sub: "Get paged the next time this reverts",
      },
    ];
  }

  // Success — completely different agenda
  if (o.topAction === "swap") {
    return [
      {
        primary: true,
        icon: "heroicons:arrows-right-left",
        label: "See exactly what this swap moved",
        sub: "Token deltas, price impact, recipients — already parsed",
      },
      {
        icon: "heroicons:beaker",
        label: "Fork-replay at this block to test a variant",
        sub: "Spin up a testnet seeded with this tx as the head",
      },
      {
        icon: "heroicons:bolt",
        label: "Wire a Web3 Action to react to swaps like this",
        sub: "Trigger when amountIn > X, route alerts, rebalance, etc.",
      },
      {
        icon: "heroicons:document-duplicate",
        label: "Diff with the last reverted swap from this sender",
        sub: "What's different about this one that worked?",
      },
    ];
  }

  return [
    {
      primary: true,
      icon: "heroicons:eye",
      label: "Inspect the state diff",
      sub: "Which slots changed, by how much, and where",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Mock data per outcome                                              */
/* ------------------------------------------------------------------ */

const REVERT_TX = {
  hash: "0x9c41a0b8e6d2f3a2c8b1f4e7d9a3b6c5e8f1a4b7c0d3e6f9a2b5c8e1f4a7b0c3",
  from: "0xA1b2…C3d4",
  to: "PulseX Router",
  block: 21_840_194,
  age: "18 minutes ago",
  gas: "184,392 / 250,000",
};

const SUCCESS_TX = {
  hash: "0x4ade1f02b8e588a4007cd13321aa55bf07e1d77ee0aa121f02b8e5c8b1f481b0",
  from: "0x77eE…aa12",
  to: "PulseX Router",
  block: 21_840_192,
  age: "2 hours ago",
  gas: "142,008 / 200,000",
};

const STAGES_REVERT: Stage[] = [
  { key: "summary", label: "Summary", done: true },
  { key: "decoded", label: "Decoded call", done: true },
  { key: "trace", label: "Call trace", done: true },
  { key: "opcodes", label: "Opcodes", done: false, current: true },
  { key: "state", label: "State diff", done: false },
  { key: "fix", label: "Simulate a fix", done: false },
];

const STAGES_SUCCESS: Stage[] = [
  { key: "summary", label: "Summary", done: true },
  { key: "decoded", label: "Decoded call", done: true },
  { key: "trace", label: "Call trace", done: true },
  { key: "deltas", label: "Token deltas", done: true },
  { key: "state", label: "State diff", done: true, current: true },
];

function decodedCallLens(): Lens {
  return {
    key: "decoded",
    title: "Decoded call",
    icon: "heroicons:code-bracket",
    body: (
      <div className="font-mono text-xs leading-relaxed theme-text">
        <span className="theme-accent">swapExactTokensForTokens</span>
        <span className="theme-text-muted">(</span>
        <div className="pl-4">
          amountIn: <span className="theme-warning">1000000000000000000</span>{" "}
          <span className="theme-text-muted">// 1.0</span>
        </div>
        <div className="pl-4">amountOutMin: <span className="theme-warning">0</span></div>
        <div className="pl-4">path: [<span className="theme-success">WPLS</span>, <span className="theme-success">HEX</span>]</div>
        <div className="pl-4">to: <span className="theme-text">0xA1b2…C3d4</span></div>
        <span className="theme-text-muted">)</span>
      </div>
    ),
  };
}

function lensesFor(o: Outcome): Lens[] {
  if (o.kind === "revert") {
    return [
      decodedCallLens(),
      {
        key: "trace",
        title: "Call trace",
        icon: "heroicons:list-bullet",
        body: (
          <div className="font-mono text-xs leading-relaxed">
            <div className="theme-text flex items-center gap-inline">
              <Icon icon="heroicons:arrow-long-right" className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              <span>Router.swapExactTokensForTokens</span>
            </div>
            <div className="pl-4 theme-text-secondary flex items-center gap-inline">
              <Icon icon="heroicons:arrow-long-right" className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              <span>WPLS.transferFrom(user, pair, 1e18)</span>
            </div>
            <div className="pl-8 theme-danger flex items-center gap-inline">
              <Icon icon="heroicons:x-mark" className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
              <span>REVERT: TRANSFER_FROM_FAILED</span>
            </div>
            <div className="pl-4 theme-text-muted">(execution stops, gas refunded after 184,392)</div>
          </div>
        ),
      },
      {
        key: "risks",
        title: "Risks",
        icon: "heroicons:exclamation-triangle",
        body: (
          <div className="space-y-2">
            <div className="flex items-start gap-inline text-xs">
              <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold theme-warning-bg theme-warning">warning</span>
              <span className="theme-text-secondary">Slippage tolerance is 0 — any price move reverts.</span>
            </div>
            <div className="flex items-start gap-inline text-xs">
              <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold theme-danger-bg theme-danger">danger</span>
              <span className="theme-text-secondary">Missing token approval — sender allowance is 0 for WPLS → Router.</span>
            </div>
          </div>
        ),
      },
      {
        key: "state",
        title: "State diff",
        icon: "heroicons:arrows-right-left",
        body: <div className="text-xs theme-text-muted">Reverted txs produce no state diff. Re-run as a simulation to see what <em>would</em> have changed.</div>,
      },
    ];
  }

  // Success
  return [
    decodedCallLens(),
    {
      key: "deltas",
      title: "Token deltas",
      icon: "heroicons:arrows-right-left",
      body: (
        <div className="font-mono text-xs space-y-1.5">
          <div className="theme-text-secondary">
            <span className="theme-danger">−1.0 WPLS</span>{" "}
            <span className="theme-text-muted">from 0x77eE…aa12</span>
          </div>
          <div className="theme-text-secondary">
            <span className="theme-success">+12,488.21 HEX</span>{" "}
            <span className="theme-text-muted">to 0x77eE…aa12</span>
          </div>
          <div className="pt-1 theme-text-muted">
            Effective rate 12,488.21 HEX/WPLS · slippage 0.18%
          </div>
        </div>
      ),
    },
    {
      key: "state",
      title: "State diff",
      icon: "heroicons:list-bullet",
      body: (
        <div className="font-mono text-xs space-y-1 theme-text-secondary">
          <div>WPLS.balanceOf[Pair] <span className="theme-success">+1e18</span></div>
          <div>HEX.balanceOf[Pair] <span className="theme-danger">−1.248e22</span></div>
          <div>WPLS.balanceOf[User] <span className="theme-danger">−1e18</span></div>
          <div>HEX.balanceOf[User] <span className="theme-success">+1.248e22</span></div>
        </div>
      ),
    },
    {
      key: "risks",
      title: "Risks",
      icon: "heroicons:shield-check",
      body: (
        <div className="flex items-start gap-inline text-xs">
          <span className="px-1.5 py-0.5 text-[10px] uppercase font-semibold theme-success-bg theme-success">clear</span>
          <span className="theme-text-secondary">No findings. Slippage realised was within healthy bounds.</span>
        </div>
      ),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function JourneyDraft() {
  const [outcome, setOutcome] = useState<Outcome>({
    kind: "revert",
    reason: "TransferHelper: TRANSFER_FROM_FAILED",
    topAction: "swap",
  });
  const [activeLens, setActiveLens] = useState<string | null>(null);

  const isRevert = outcome.kind === "revert";
  const tx = isRevert ? REVERT_TX : SUCCESS_TX;
  const stages = isRevert ? STAGES_REVERT : STAGES_SUCCESS;
  const lenses = lensesFor(outcome);
  const nextSteps = nextStepsFor(outcome);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-5">
        <Link
          to="/drafts"
          className="text-xs flex items-center gap-1.5 theme-text-muted"
        >
          <Icon icon="heroicons:chevron-left" className="w-3 h-3" />
          Back to drafts
        </Link>
        <div className="flex text-xs bs-in">
          {[
            { key: "revert", label: "Reverted swap" },
            { key: "success", label: "Successful swap" },
          ].map((o) => {
            const sel = (o.key === "revert") === isRevert;
            return (
              <button
                key={o.key}
                onClick={() =>
                  setOutcome(
                    o.key === "revert"
                      ? { kind: "revert", reason: "TransferHelper: TRANSFER_FROM_FAILED", topAction: "swap" }
                      : { kind: "success", topAction: "swap" },
                  )
                }
                className="px-3 py-1.5 transition-colors"
                style={{
                  backgroundColor: sel ? "var(--color-accent-muted)" : "transparent",
                  color: sel ? "var(--color-accent)" : "var(--color-text-secondary)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Header card */}
      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-widest mb-2 theme-text-muted">
              Transaction
            </div>
            <div className="font-mono text-sm break-all mb-3 theme-text">
              {tx.hash}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs theme-text-secondary">
              <span>From <code className="theme-text">{tx.from}</code></span>
              <span>To <code className="theme-text">{tx.to}</code></span>
              <span>Block {tx.block.toLocaleString()}</span>
              <span>{tx.age}</span>
              <span>Gas {tx.gas}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-inline">
            <StatusBadge success={!isRevert} size="lg" />
            {isRevert && (
              <div
                className="text-xs font-mono px-2 py-1 theme-danger-bg theme-danger"
              >
                {outcome.reason}
              </div>
            )}
            {!isRevert && (
              <div
                className="text-xs font-mono px-2 py-1 flex items-center gap-inline theme-success-bg theme-success"
              >
                <span>1.0 WPLS</span>
                <Icon icon="heroicons:arrow-long-right" className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                <span>12,488.21 HEX</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-widest mb-3 theme-text-muted">
          Investigation
        </div>
        <div className="flex items-center gap-tight flex-wrap">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-tight">
              <div
                className="flex items-center gap-inline px-3 py-1.5 text-xs"
                style={{
                  backgroundColor:
                    s.done && !s.current ? "var(--color-bg-tertiary)"
                    : s.current ? "var(--color-accent-muted)"
                    : "transparent",
                  color:
                    s.done && !s.current ? "var(--color-text-secondary)"
                    : s.current ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                  boxShadow: s.current
                    ? "inset 0 0 0 1px var(--color-accent)"
                    : "inset 0 0 0 1px var(--color-border-muted)",
                }}
              >
                <Icon
                  icon={s.current ? "heroicons:play" : s.done ? "heroicons:check" : "heroicons:minus"}
                  className="w-3 h-3"
                />
                {s.label}
              </div>
              {i < stages.length - 1 && (
                <Icon icon="heroicons:chevron-right" className="w-3 h-3 theme-text-muted" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lenses + rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-stack">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lenses.map((l) => {
            const isExpanded = activeLens === l.key;
            return (
              <div
                key={l.key}
                className="card p-2 sm:p-4 transition-all cursor-pointer"
                onClick={() => setActiveLens(isExpanded ? null : l.key)}
                style={{ gridColumn: isExpanded ? "1 / -1" : undefined }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-inline text-xs uppercase tracking-widest theme-text-muted">
                    <Icon icon={l.icon} className="w-3.5 h-3.5" />
                    {l.title}
                  </div>
                  <Icon
                    icon={isExpanded ? "heroicons:arrows-pointing-in" : "heroicons:arrows-pointing-out"}
                    className="w-3.5 h-3.5 theme-text-muted"
                  />
                </div>
                {l.body}
              </div>
            );
          })}
        </div>

        <aside>
          <div className="text-[10px] uppercase tracking-widest mb-3 theme-text-muted">
            What to do next
          </div>
          <div className="space-y-2">
            {nextSteps.map((s, i) => (
              <button
                key={i}
                className="w-full p-3 text-left transition-colors"
                style={{
                  backgroundColor: s.primary ? "var(--color-accent-muted)" : "var(--color-bg-secondary)",
                  boxShadow: s.primary
                    ? "inset 0 0 0 1px var(--color-accent)"
                    : "inset 0 0 0 1px var(--color-border-muted)",
                }}
              >
                <div className="flex items-start gap-2.5">
                  <Icon
                    icon={s.icon}
                    className={`w-4 h-4 mt-0.5 shrink-0 ${s.primary ? "theme-accent" : "theme-text-secondary"}`}
                  />
                  <div className="min-w-0">
                    <div className={`text-sm font-medium leading-snug mb-1 ${s.primary ? "theme-accent" : "theme-text"}`}>
                      {s.label}
                    </div>
                    <div className="text-xs leading-snug theme-text-muted">
                      {s.sub}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
