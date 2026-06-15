import type { BlockStats } from "../../api/networkHealth";
import { formatGwei } from "../../lib/format/tokenAmount";
import { SplitBar } from "./SplitBar";
import { pct, shareOf, timeAgo } from "./format";

/** Per-block breakdown, newest first, with a queue-jump indicator by type. */
export function BlockTable({ blocks }: { blocks: BlockStats[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm theme-mono">
        <thead>
          <tr className="text-xs uppercase tracking-wide theme-text-muted">
            <Th>Block</Th>
            <Th>Age</Th>
            <Th right>Txns</Th>
            <Th right>Base fee</Th>
            <Th right>Legacy gas</Th>
            <Th right>Inversions</Th>
            <Th>Queue-jump</Th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <BlockRow key={b.number} block={b} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockRow({ block }: { block: BlockStats }) {
  const over = block.overPrioritizedGasByType;
  const overTotal = (BigInt(over.legacy) + BigInt(over.modern)).toString();
  const hasJump = overTotal !== "0";
  return (
    <tr className="bs-t-muted">
      <Td>
        <span className="theme-accent">#{block.number}</span>
      </Td>
      <Td muted>{timeAgo(block.timestamp)}</Td>
      <Td right>{block.txCount}</Td>
      <Td right>{formatGwei(block.baseFeePerGas) ?? "—"}</Td>
      <Td right>{pct(block.legacyGasShare, 0)}</Td>
      <Td right>
        <InversionCell rate={block.priorityInversionRate} />
      </Td>
      <Td>
        {hasJump ? (
          <div className="w-20" title="over-prioritized gas, legacy vs modern">
            <SplitBar legacyFraction={shareOf(over.legacy, overTotal)} />
          </div>
        ) : (
          <span className="theme-text-muted">—</span>
        )}
      </Td>
    </tr>
  );
}

function InversionCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="theme-text-muted">—</span>;
  // Above ~15% out-of-order is worth a second look; flag it warmly.
  const cls = rate > 0.15 ? "theme-warning" : "theme-text";
  return <span className={cls}>{pct(rate, 0)}</span>;
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
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
