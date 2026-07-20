import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { MinerStats } from "../../api/networkHealth";
import { nativeAmount, pct } from "./format";
import { MiddleTruncate } from "../primitives/MiddleTruncate";
import { DataTable, type Column } from "../primitives/DataTable";

/**
 * Per-validator rollup over the loaded window — who produced what. Descriptive,
 * not accusatory: the exclusion investigation found no per-miner type bias, so
 * this surfaces production share, earnings (tips), burn caused, tx-type mix, and
 * each producer's ordering cleanliness.
 */
export function MinersPanel({
  miners,
  symbol,
  totalBlocks,
}: {
  miners: MinerStats[] | undefined;
  symbol: string;
  totalBlocks: number;
}) {
  // collapsed by default — secondary to the per-block view below.
  const [open, setOpen] = useState(false);
  // miners may be absent on a stale persisted response (added after first ship).
  if (!miners || !miners.length) return null;

  const columns: Column<MinerStats>[] = [
    {
      key: "validator",
      header: "Validator",
      primary: true,
      cell: (m) => (
        <Link to={`/address/${m.miner}`} className="theme-accent hover:underline">
          <MiddleTruncate value={m.miner} className="font-mono theme-accent" />
        </Link>
      ),
    },
    {
      key: "blocks",
      header: "Blocks",
      cell: (m) => <div className="text-right theme-text">{m.blocks}</div>,
    },
    {
      key: "share",
      header: "Share",
      cell: (m) => <ShareBar frac={totalBlocks ? m.blocks / totalBlocks : 0} />,
    },
    {
      key: "tips",
      header: "Tips earned",
      cell: (m) => (
        <div className="text-right" style={{ color: "var(--color-success)" }}>
          {nativeAmount(m.tips, symbol)}
        </div>
      ),
    },
    {
      key: "burned",
      header: "Burned",
      cell: (m) => (
        <div className="text-right theme-text-secondary">
          {nativeAmount(m.burned, symbol)}
        </div>
      ),
    },
    {
      key: "legacyGas",
      header: "Legacy gas",
      cell: (m) => <div className="text-right theme-text">{pct(m.legacyGasShare, 0)}</div>,
    },
    {
      key: "inversion",
      header: "Out of order",
      cell: (m) => (
        <div className="text-right">
          <Inversion rate={m.priorityInversionRate} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-stack">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-tight text-sm uppercase tracking-wide theme-text-secondary hover:theme-text"
      >
        <Icon
          icon={open ? "heroicons:chevron-down" : "heroicons:chevron-right"}
          className="w-4 h-4"
        />
        Validators ({miners.length})
      </button>
      {open && (
        <div className="card overflow-hidden">
          <DataTable
            columns={columns}
            rows={miners}
            rowKey={(m) => m.miner}
            className="w-full text-sm theme-mono"
            emptyLabel="No validators in this window"
          />
        </div>
      )}
    </div>
  );
}

function ShareBar({ frac }: { frac: number }) {
  return (
    <div className="h-2 w-24 bs-in-muted">
      <div
        className="h-full"
        style={{
          width: `${Math.round(Math.min(1, frac) * 100)}%`,
          backgroundColor: "var(--color-accent)",
        }}
      />
    </div>
  );
}

function Inversion({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="theme-text-muted">—</span>;
  return (
    <span className={rate > 0.15 ? "theme-warning" : "theme-text"}>
      {pct(rate, 0)}
    </span>
  );
}
