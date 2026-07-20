import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import { SourceTab } from "../explorer/ContractView/SourceCodeTab";
import StorageLayoutViewer from "../StorageLayoutViewer";

const MOCK_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IPulseXRouter.sol";
import "./libraries/TransferHelper.sol";

contract PulseXRouter is IPulseXRouter {
    address public immutable factory;
    address public immutable WPLS;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, "Router: EXPIRED");
        _;
    }

    constructor(address _factory, address _WPLS) {
        factory = _factory;
        WPLS = _WPLS;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external ensure(deadline) returns (uint[] memory amounts) {
        amounts = PulseXLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PulseXLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }
    // … (truncated for draft preview)
}`;

const ADDR = {
  name: "PulseX Router",
  address: "0x165C3410fC91EF562C50559f7d2289fEbed552d9",
  verified: true,
  proxy: false,
  riskScore: "low" as "low" | "medium" | "high",
  txCount24h: 14_283,
  uniqueCallers24h: 3_184,
  lastDeploy: "2024-08-11",
  compiler: "0.8.20+commit.a1b79de6",
};

type SubTab = { key: string; label: string; icon: string; badge?: string };
const SUB_TABS: SubTab[] = [
  { key: "activity", label: "Activity", icon: "heroicons:chart-bar", badge: "14k" },
  { key: "source", label: "Source", icon: "heroicons:code-bracket" },
  { key: "storage", label: "Storage", icon: "heroicons:rectangle-stack" },
  { key: "risks", label: "Risks", icon: "heroicons:shield-check", badge: "2" },
  { key: "diff", label: "Diff", icon: "heroicons:document-duplicate" },
  { key: "verify", label: "Re-verify", icon: "heroicons:check-badge" },
];

const ACTIVITY_ROWS = [
  { hash: "0x9c41…f3a2", method: "swapExactTokensForTokens", ok: false, age: "18m", from: "0xA1b2…C3d4" },
  { hash: "0x4ade…81b0", method: "addLiquidity", ok: true, age: "2h", from: "0x77eE…aa12" },
  { hash: "0x1f02…b8e5", method: "swapExactPLSForTokens", ok: true, age: "2h", from: "0x002F…99c0" },
  { hash: "0x88a4…007c", method: "removeLiquidity", ok: true, age: "3h", from: "0xff01…1244" },
  { hash: "0xd133…21aa", method: "swapTokensForExactTokens", ok: false, age: "3h", from: "0x5bf0…7e1d" },
];

const CONTEXT_BLOCKS = [
  {
    title: "Verified by",
    icon: "heroicons:check-badge",
    body: (
      <div className="text-xs space-y-1.5 theme-text-secondary">
        <div className="flex justify-between"><span>BlockScout</span><Icon icon="heroicons:check" className="w-4 h-4 theme-success" aria-hidden /></div>
        <div className="flex justify-between"><span>Sourcify (full match)</span><Icon icon="heroicons:check" className="w-4 h-4 theme-success" aria-hidden /></div>
        <div className="flex justify-between"><span>Slither analysis</span><span className="theme-text-muted">cached 4d ago</span></div>
      </div>
    ),
  },
  {
    title: "Live signals",
    icon: "heroicons:signal",
    body: (
      <div className="text-xs space-y-1.5 theme-text-secondary">
        <div className="flex justify-between"><span>Calls last 1h</span><span className="font-mono theme-text">612</span></div>
        <div className="flex justify-between"><span>Revert rate 1h</span><span className="font-mono theme-warning">3.1%</span></div>
        <div className="flex justify-between"><span>Median gas</span><span className="font-mono theme-text">142k</span></div>
      </div>
    ),
  },
  {
    title: "Related",
    icon: "heroicons:link",
    body: (
      <div className="text-xs space-y-1.5">
        <a className="block hover:underline theme-accent">PulseX Factory</a>
        <a className="block hover:underline theme-accent">WPLS (wrapped native)</a>
        <a className="block hover:underline theme-accent">PulseX v1 (deprecated)</a>
      </div>
    ),
  },
];

function RiskDot({ level }: { level: "low" | "medium" | "high" }) {
  const color =
    level === "low" ? "var(--color-success)"
    : level === "medium" ? "var(--color-warning)"
    : "var(--color-danger)";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5"
      style={{
        backgroundColor:
          level === "low" ? "var(--color-success-muted)"
          : level === "medium" ? "var(--color-warning-muted)"
          : "var(--color-danger-muted)",
        color,
      }}
    >
      <span className="w-1.5 h-1.5" style={{ backgroundColor: color, borderRadius: "9999px" }} />
      {level} risk
    </span>
  );
}

export default function WorkspaceDraft() {
  const [tab, setTab] = useState<string>("activity");

  return (
    <div className="p-4">
      <Link
        to="/drafts"
        className="text-xs flex items-center gap-1.5 mb-5 theme-text-muted"
      >
        <Icon icon="heroicons:chevron-left" className="w-3 h-3" />
        Back to drafts
      </Link>

      {/* Address header */}
      <div className="card mb-5">
        <div className="p-5 card-divider">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-row mb-2">
                <h1 className="text-2xl font-semibold theme-text">
                  {ADDR.name}
                </h1>
                {ADDR.verified && (
                  <Icon
                    icon="heroicons:check-badge-solid"
                    className="w-5 h-5 theme-success"
                  />
                )}
                <RiskDot level={ADDR.riskScore} />
              </div>
              <div
                className="font-mono text-xs break-all theme-text-secondary"
              >
                {ADDR.address}
              </div>
            </div>
            <div className="flex gap-inline flex-wrap">
              <button
                className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                <Icon icon="heroicons:play-circle" className="w-3.5 h-3.5" />
                Simulate a call
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 theme-text-secondary bs-in"
              >
                <Icon icon="heroicons:bell-alert" className="w-3.5 h-3.5" />
                Watch
              </button>
              <button
                className="px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 theme-text-secondary bs-in"
              >
                <Icon icon="heroicons:beaker" className="w-3.5 h-3.5" />
                Fork to testnet
              </button>
            </div>
          </div>
        </div>

        {/* Sub-tab bar — INSIDE the workspace, not at app top */}
        <nav className="flex overflow-x-auto">
          {SUB_TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 ${active ? "theme-text" : "theme-text-secondary"}`}
                style={{
                  borderBottom: active
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                }}
              >
                <Icon icon={t.icon} className="w-3.5 h-3.5" />
                {t.label}
                {t.badge && (
                  <span
                    className="ml-1 px-1.5 py-0.5 text-[10px] font-mono theme-tertiary-bg theme-text-muted"
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Body: tab content + context rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-stack">
        <div className="card p-5 min-h-[400px]">
          {tab === "activity" && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div
                  className="text-xs uppercase tracking-widest theme-text-muted"
                >
                  Recent calls
                </div>
                <div
                  className="text-xs theme-text-muted"
                >
                  {ADDR.txCount24h.toLocaleString()} txs · {ADDR.uniqueCallers24h.toLocaleString()} callers (24h)
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="theme-text-muted">
                      <th className="text-left pb-2 font-normal">Method</th>
                      <th className="text-left pb-2 font-normal">Hash</th>
                      <th className="text-left pb-2 font-normal">From</th>
                      <th className="text-left pb-2 font-normal">Age</th>
                      <th className="text-left pb-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ACTIVITY_ROWS.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t"
                        style={{ borderColor: "var(--color-border-muted)" }}
                      >
                        <td className="py-2.5 theme-text">{r.method}</td>
                        <td className="theme-accent">{r.hash}</td>
                        <td className="theme-text-secondary">{r.from}</td>
                        <td className="theme-text-muted">{r.age}</td>
                        <td>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-sans ${r.ok ? "theme-success-bg theme-success" : "theme-danger-bg theme-danger"}`}
                          >
                            {r.ok ? "ok" : "reverted"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "source" && (
            <>
              <div className="mb-3 text-[10px] uppercase tracking-widest flex items-center gap-1.5 theme-text-muted">
                <Icon icon="heroicons:link" className="w-3 h-3" />
                Rendered via the existing <code className="mx-1 theme-text-secondary">SourceTab</code> component
              </div>
              <SourceTab sourceCode={MOCK_SOURCE} />
            </>
          )}

          {tab === "storage" && (
            <>
              <div className="mb-3 text-[10px] uppercase tracking-widest flex items-center gap-1.5 theme-text-muted">
                <Icon icon="heroicons:link" className="w-3 h-3" />
                Rendered via the existing <code className="mx-1 theme-text-secondary">StorageLayoutViewer</code>
              </div>
              <StorageLayoutViewer />
            </>
          )}

          {tab !== "activity" && tab !== "source" && tab !== "storage" && (
            <div
              className="h-full min-h-[300px] flex flex-col items-center justify-center text-center theme-text-muted"
            >
              <Icon
                icon={SUB_TABS.find((t) => t.key === tab)?.icon ?? "heroicons:cube"}
                className="w-12 h-12 mb-3"
              />
              <div className="text-sm">
                {SUB_TABS.find((t) => t.key === tab)?.label} panel mounts here.
              </div>
              <div className="text-xs mt-1">
                In production this is the existing component from
                <code className="ml-1 theme-text-secondary">
                  /{tab}
                </code>
                , rendered in context.
              </div>
            </div>
          )}
        </div>

        {/* Context rail — "what should I know about this thing?" */}
        <aside className="space-y-stack">
          {CONTEXT_BLOCKS.map((b) => (
            <div key={b.title} className="card p-4">
              <div
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest mb-3 theme-text-muted"
              >
                <Icon icon={b.icon} className="w-3 h-3" />
                {b.title}
              </div>
              {b.body}
            </div>
          ))}
          <div
            className="text-[10px] font-mono px-1 theme-text-muted"
          >
            compiler {ADDR.compiler} · deployed {ADDR.lastDeploy}
          </div>
        </aside>
      </div>
    </div>
  );
}
