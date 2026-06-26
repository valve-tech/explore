import type { AddressToken } from "../../../api/explorer";
import { truncateAddr } from "../format";
import type { AddressNavTarget } from "./TransactionsTab";
import { Tooltip } from "../../primitives/Tooltip";

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
  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      {indexed && tokens.length > 0 && (
        <div className="px-3 py-1.5 text-[10px] theme-text-muted bs-b-muted">
          Balances from the indexed balance-changes archive (storage-diff truth).
        </div>
      )}
      {tokens.length === 0 ? (
        <div
          className="p-4 text-center text-sm theme-text-muted"
        >
          No tokens found
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="theme-secondary-bg">
              {["Token", "Symbol", "Balance", "Contract", "Type"].map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-xs font-medium theme-text-secondary"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((token, i) => (
              <tr
                key={i}
                className="bs-t-muted hover:opacity-80"
                style={{}}
              >
                <td
                  className="px-3 py-2 theme-text"
                >
                  {token.name || "Unknown"}
                </td>
                <td
                  className="px-3 py-2 font-mono theme-text-secondary"
                >
                  {token.symbol}
                </td>
                <td
                  className="px-3 py-2 font-mono theme-text"
                >
                  {token.formattedBalance}
                </td>
                <td className="px-3 py-2">
                  <Tooltip label={token.contractAddress}>
                    <button
                      onClick={() =>
                        onNavigate({
                          type: "address",
                          value: token.contractAddress,
                        })
                      }
                      className="font-mono text-xs hover:underline cursor-pointer theme-accent"
                    >
                      {truncateAddr(token.contractAddress)}
                    </button>
                  </Tooltip>
                </td>
                <td className="px-3 py-2">
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded theme-secondary-bg theme-text-secondary"
                  >
                    {token.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
