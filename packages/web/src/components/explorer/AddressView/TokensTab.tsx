import type { AddressToken } from "../../../api/explorer";
import type { AddressNavTarget } from "./TransactionsTab";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";
import { DataTable, type Column } from "../../primitives/DataTable";
import { spamSignalReason, tokenSpamSignals } from "../../../lib/tokenSpam";

export function TokensTab({
  tokens,
  onNavigate,
  indexed = false,
}: {
  tokens: AddressToken[];
  onNavigate: (target: AddressNavTarget) => void;
  /** True when balances came from the indexed balance-changes archive. */
  indexed?: boolean;
}) {
  const columns: Column<AddressToken>[] = [
    {
      key: "name",
      header: "Token",
      primary: true,
      cell: (token) => {
        // Token names are attacker-controlled: anyone can deploy an ERC-20,
        // name it a lure and airdrop it here. Marked, never hidden — a false
        // positive that removed a row would take a real balance off the page.
        const signals = tokenSpamSignals(token.name, token.symbol);
        if (signals.length === 0) {
          return <span className="theme-text">{token.name || "Unknown"}</span>;
        }
        return (
          <span className="inline-flex items-baseline gap-tight min-w-0">
            <span
              className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold shrink-0 theme-tertiary-bg theme-text-secondary"
              title={spamSignalReason(signals)}
            >
              unverified
            </span>
            <span className="min-w-0 break-all theme-text-muted" title={spamSignalReason(signals)}>
              {token.name || "Unknown"}
            </span>
          </span>
        );
      },
    },
    {
      key: "symbol",
      header: "Symbol",
      cell: (token) => <span className="font-mono theme-text-secondary">{token.symbol}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      cell: (token) => <span className="font-mono theme-text">{token.formattedBalance}</span>,
    },
    {
      key: "contract",
      header: "Contract",
      cell: (token) => (
        <button
          onClick={() =>
            onNavigate({
              type: "address",
              value: token.contractAddress,
            })
          }
          className="font-mono text-xs hover:underline cursor-pointer theme-accent"
        >
          <MiddleTruncate value={token.contractAddress} className="font-mono text-xs theme-accent" />
        </button>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (token) => (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded theme-secondary-bg theme-text-secondary">
          {token.type}
        </span>
      ),
    },
  ];

  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      {indexed && tokens.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] theme-text-muted bs-b-muted">
          Balances from the indexed balance-changes archive (storage-diff truth).
        </div>
      )}
      <DataTable
        columns={columns}
        rows={tokens}
        rowKey={(token, i) => `${token.contractAddress}-${i}`}
        emptyLabel="No tokens found"
      />
    </div>
  );
}
