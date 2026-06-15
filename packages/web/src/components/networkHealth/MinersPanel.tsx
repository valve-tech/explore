import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { MinerStats } from "../../api/networkHealth";
import { nativeAmount, pct } from "./format";

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
      <div className="card overflow-x-auto">
        <table className="w-full text-sm theme-mono">
          <thead>
            <tr className="text-xs uppercase tracking-wide theme-text-muted">
              <Th>Validator</Th>
              <Th right>Blocks</Th>
              <Th>Share</Th>
              <Th right>Tips earned</Th>
              <Th right>Burned</Th>
              <Th right>Legacy gas</Th>
              <Th right>Out of order</Th>
            </tr>
          </thead>
          <tbody>
            {miners.map((m) => (
              <tr key={m.miner} className="bs-t-muted">
                <Td>
                  <Link
                    to={`/address/${m.miner}`}
                    className="theme-accent hover:underline"
                  >
                    {short(m.miner)}
                  </Link>
                </Td>
                <Td right>{m.blocks}</Td>
                <Td>
                  <ShareBar frac={totalBlocks ? m.blocks / totalBlocks : 0} />
                </Td>
                <Td right>
                  <span style={{ color: "var(--color-success)" }}>
                    {nativeAmount(m.tips, symbol)}
                  </span>
                </Td>
                <Td right muted>{nativeAmount(m.burned, symbol)}</Td>
                <Td right>{pct(m.legacyGasShare, 0)}</Td>
                <Td right>
                  <Inversion rate={m.priorityInversionRate} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
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

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`p-2 font-normal ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`p-2 ${right ? "text-right" : "text-left"} ${
        muted ? "theme-text-secondary" : "theme-text"
      }`}
    >
      {children}
    </td>
  );
}
