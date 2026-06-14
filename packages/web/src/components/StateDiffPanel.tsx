import { apiUrl } from "../lib/apiBase";
import { Icon } from "@iconify/react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StateDiff, BalanceChange, StorageChange, NonceChange } from "../api/simulate";
import {
  buildSlotIndex,
  decodeChangeAtSlot,
  type StorageLayout,
} from "../lib/storageDecode";
import {
  truncateHex,
  formatPlsValue,
  isDeltaPositive,
  formatDecodedShort,
} from "./StateDiffPanel/formatters";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  count,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 bs-b text-left hover:opacity-80 theme-secondary-bg"
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider theme-text-secondary"
      >
        {title}
        <span
          className="ml-2 px-1.5 py-0.5 rounded text-xs font-mono theme-accent-bg theme-accent"
        >
          {count}
        </span>
      </span>
      <Icon
        icon={expanded ? "heroicons:chevron-down" : "heroicons:chevron-right"}
        className="w-3.5 h-3.5 theme-text-muted"
        aria-hidden
      />
    </button>
  );
}

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr
        className="bs-b-muted"
        style={{}}
      >
        {cols.map((col) => (
          <th
            key={col}
            className="px-3 py-1.5 text-left text-xs font-semibold theme-text-muted"
          >
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// ---------------------------------------------------------------------------
// Balance Changes
// ---------------------------------------------------------------------------

function BalanceChangesSection({ changes }: { changes: BalanceChange[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <SectionHeader
        title="Balance Changes"
        count={changes.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <TableHeader cols={["Address", "Before (PLS)", "After (PLS)", "Delta"]} />
            <tbody>
              {changes.map((change, i) => {
                const positive = isDeltaPositive(change.delta);
                const deltaClass = positive ? "theme-success" : "theme-danger";
                const deltaPrefix = positive ? "+" : "";

                return (
                  <tr
                    key={i}
                    className="bs-b-muted last:shadow-none"
                    style={{}}
                  >
                    <td
                      className="px-3 py-2 theme-mono theme-text"
                      title={change.address}
                    >
                      {truncateHex(change.address)}
                    </td>
                    <td
                      className="px-3 py-2 theme-text-secondary"
                    >
                      {formatPlsValue(change.before)}
                    </td>
                    <td
                      className="px-3 py-2 theme-text"
                    >
                      {formatPlsValue(change.after)}
                    </td>
                    <td className={`px-3 py-2 font-semibold theme-mono ${deltaClass}`}>
                      {deltaPrefix}
                      {formatPlsValue(change.delta.replace(/^-/, ""))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storage Changes
// ---------------------------------------------------------------------------

function StorageGroup({
  address,
  contractName,
  rows,
}: {
  address: string;
  contractName: string | undefined;
  rows: StorageChange[];
}) {
  const [expanded, setExpanded] = useState(true);

  const label = contractName
    ? `${contractName} (${truncateHex(address)})`
    : truncateHex(address);

  // Per-contract storage layout. TanStack Query dedupes across
  // simultaneously-mounted StorageGroups for the same address (e.g. a
  // proxy + impl pair) and the IndexedDB persistor (configured in main.tsx)
  // keeps the layout warm across reloads. The 404 case is benign — many
  // contracts have no verified source, and the panel just falls through to
  // raw hex.
  const { data: layout } = useQuery({
    queryKey: ["storage-layout", address.toLowerCase()],
    queryFn: async (): Promise<StorageLayout | null> => {
      const res = await fetch(apiUrl(`/api/source/${address}/storage-layout`));
      if (!res.ok) return null;
      const body = (await res.json()) as {
        ok: boolean;
        storageLayout?: StorageLayout;
      };
      return body.storageLayout ?? null;
    },
  });

  const slotIndex = useMemo(
    () => (layout ? buildSlotIndex(layout) : null),
    [layout],
  );

  return (
    <div className="bs-b-muted last:shadow-none">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:opacity-80 theme-secondary-bg"
      >
        <span
          className="text-xs font-medium theme-mono theme-text"
          title={address}
        >
          {label}
        </span>
        <div className="flex items-center gap-inline">
          <span
            className="text-xs px-1.5 py-0.5 rounded theme-accent-bg theme-accent"
          >
            {rows.length} slot{rows.length !== 1 ? "s" : ""}
          </span>
          <Icon
            icon={expanded ? "heroicons:chevron-down" : "heroicons:chevron-right"}
            className="w-3.5 h-3.5 theme-text-muted"
            aria-hidden
          />
        </div>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <TableHeader cols={["Slot", "Variable", "Before", "After"]} />
            <tbody>
              {rows.flatMap((row, i) => {
                const decoded = slotIndex
                  ? decodeChangeAtSlot(slotIndex, row.slot, row.before, row.after)
                  : null;

                // Fall back to a raw row when the slot doesn't match a known
                // inplace layout entry (mappings, dynamic arrays, missing
                // layout). `row.decodedName` may still carry a hint from the
                // backend even when the SDK decoder can't decode the value.
                if (!decoded) {
                  return [
                    <tr
                      key={i}
                      className="bs-b-muted last:shadow-none"
                    >
                      <td
                        className="px-3 py-2 theme-mono theme-text-muted"
                        title={row.slot}
                      >
                        {truncateHex(row.slot)}
                      </td>
                      <td className="px-3 py-2 theme-text-secondary">
                        {row.decodedName ?? "—"}
                      </td>
                      <td
                        className="px-3 py-2 theme-mono theme-text-muted"
                        title={row.before}
                      >
                        {truncateHex(row.before)}
                      </td>
                      <td
                        className="px-3 py-2 theme-mono theme-accent"
                        title={row.after}
                      >
                        {truncateHex(row.after)}
                      </td>
                    </tr>,
                  ];
                }

                // One row per packed variable. The slot column is rendered on
                // the FIRST packed variable only so groups stay visually
                // connected; subsequent rows show the variable's offset suffix
                // (e.g. "+12") instead.
                return decoded.map((dec, j) => {
                  const beforeShort = formatDecodedShort(dec.before);
                  const afterShort = formatDecodedShort(dec.after);
                  const isFirst = j === 0;
                  return (
                    <tr
                      key={`${i}-${j}`}
                      className="bs-b-muted last:shadow-none"
                    >
                      <td
                        className="px-3 py-2 theme-mono theme-text-muted align-top"
                        title={row.slot}
                      >
                        {isFirst ? truncateHex(row.slot) : `+${dec.entry.offset}`}
                      </td>
                      <td className="px-3 py-2 theme-text align-top">
                        <div>{dec.entry.label}</div>
                        <div className="text-xs theme-text-muted theme-mono">
                          {dec.type.label}
                        </div>
                      </td>
                      <td
                        className="px-3 py-2 theme-text-muted align-top"
                        title={row.before}
                      >
                        <div className="theme-text">
                          {beforeShort ?? truncateHex(row.before)}
                        </div>
                        {beforeShort !== null && (
                          <div className="text-xs theme-mono theme-text-muted">
                            {truncateHex(row.before)}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 align-top"
                        title={row.after}
                      >
                        <div className="theme-accent">
                          {afterShort ?? truncateHex(row.after)}
                        </div>
                        {afterShort !== null && (
                          <div className="text-xs theme-mono theme-text-muted">
                            {truncateHex(row.after)}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StorageChangesSection({ changes }: { changes: StorageChange[] }) {
  const [expanded, setExpanded] = useState(true);

  // Group by contract address
  const groups = changes.reduce(
    (acc, change) => {
      const existing = acc.find((g) => g.address === change.address);
      if (existing) {
        existing.rows.push(change);
      } else {
        acc.push({
          address: change.address,
          contractName: change.contractName,
          rows: [change],
        });
      }
      return acc;
    },
    [] as Array<{ address: string; contractName: string | undefined; rows: StorageChange[] }>,
  );

  return (
    <div>
      <SectionHeader
        title="Storage Changes"
        count={changes.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div>
          {groups.map((group) => (
            <StorageGroup
              key={group.address}
              address={group.address}
              contractName={group.contractName}
              rows={group.rows}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nonce Changes
// ---------------------------------------------------------------------------

function NonceChangesSection({ changes }: { changes: NonceChange[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <SectionHeader
        title="Nonce Changes"
        count={changes.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <TableHeader cols={["Address", "Before", "After"]} />
            <tbody>
              {changes.map((change, i) => (
                <tr
                  key={i}
                  className="bs-b-muted last:shadow-none"
                  style={{}}
                >
                  <td
                    className="px-3 py-2 theme-mono theme-text"
                    title={change.address}
                  >
                    {truncateHex(change.address)}
                  </td>
                  <td
                    className="px-3 py-2 theme-text-muted"
                  >
                    {change.before}
                  </td>
                  <td
                    className="px-3 py-2 theme-text"
                  >
                    {change.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StateDiffPanel
// ---------------------------------------------------------------------------

interface StateDiffPanelProps {
  stateDiff: StateDiff;
}

export default function StateDiffPanel({ stateDiff }: StateDiffPanelProps) {
  const { balanceChanges, storageChanges, nonceChanges } = stateDiff;
  const hasAnyChanges =
    balanceChanges.length > 0 || storageChanges.length > 0 || nonceChanges.length > 0;

  if (!hasAnyChanges) {
    return (
      <div
        className="rounded-lg bs p-4 text-center text-xs theme-card-bg theme-text-muted"
      >
        No state changes detected.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      {balanceChanges.length > 0 && (
        <BalanceChangesSection changes={balanceChanges} />
      )}
      {storageChanges.length > 0 && (
        <div
          style={
            balanceChanges.length > 0
              ? { boxShadow: "0 -1px 0 0 var(--color-border-default)" }
              : undefined
          }
        >
          <StorageChangesSection changes={storageChanges} />
        </div>
      )}
      {nonceChanges.length > 0 && (
        <div
          style={
            balanceChanges.length > 0 || storageChanges.length > 0
              ? { boxShadow: "0 -1px 0 0 var(--color-border-default)" }
              : undefined
          }
        >
          <NonceChangesSection changes={nonceChanges} />
        </div>
      )}
    </div>
  );
}
