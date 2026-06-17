import type { AddressTransaction } from "../../../api/explorer";
import { formatPLS, truncateAddr } from "../format";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";
import { formatRelativeTimestamp } from "./formatRelative";
import type { AddressNavTarget } from "./TransactionsTab";
import TxRowActions from "../TxRowActions";
import { ExplorerLink } from "../ExplorerLink";
import { TxGasInfo } from "../TxGasInfo";
import { Tooltip } from "../../primitives/Tooltip";

const HEADERS = ["Tx Hash", "Block", "Age", "From", "To", "Value", "Gas / Type", "Status", ""];

interface Props {
  txs: AddressTransaction[];
  ownerAddress: string;
  onNavigate: (target: AddressNavTarget) => void;
}

export function TxTable({ txs, ownerAddress, onNavigate }: Props) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="theme-secondary-bg">
          {HEADERS.map((h) => (
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
        {txs.map((tx, i) => (
          <TxRow
            key={i}
            tx={tx}
            ownerAddress={ownerAddress}
            onNavigate={onNavigate}
          />
        ))}
      </tbody>
    </table>
  );
}

function TxRow({
  tx,
  ownerAddress,
  onNavigate,
}: {
  tx: AddressTransaction;
  ownerAddress: string;
  onNavigate: (target: AddressNavTarget) => void;
}) {
  const symbol = chainSymbol(useActiveChainId());
  const isContractCreation = !tx.to || tx.to === "0x";
  const isIn =
    !isContractCreation && tx.to.toLowerCase() === ownerAddress.toLowerCase();

  return (
    <tr
      className="bs-t-muted hover:opacity-80"
      style={{}}
    >
      <td className="px-3 py-2">
        <LinkButton
          target={{ type: "tx", value: tx.hash }}
          onNavigate={onNavigate}
          title={tx.hash}
        >
          {truncateAddr(tx.hash)}
        </LinkButton>
      </td>
      <td className="px-3 py-2">
        <LinkButton
          target={{ type: "block", value: tx.blockNumber }}
          onNavigate={onNavigate}
        >
          {Number(tx.blockNumber).toLocaleString()}
        </LinkButton>
      </td>
      <td
        className="px-3 py-2 text-xs whitespace-nowrap theme-text-secondary"
      >
        {formatRelativeTimestamp(tx.timeStamp)}
      </td>
      <td className="px-3 py-2">
        <LinkButton
          target={{ type: "address", value: tx.from }}
          onNavigate={onNavigate}
          title={tx.from}
        >
          {truncateAddr(tx.from)}
        </LinkButton>
      </td>
      <td className="px-3 py-2">
        {isContractCreation ? (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider theme-accent-bg theme-accent"
          >
            Contract Creation
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <DirectionBadge isIn={isIn} />
            <LinkButton
              target={{ type: "address", value: tx.to }}
              onNavigate={onNavigate}
              title={tx.to}
            >
              {truncateAddr(tx.to)}
            </LinkButton>
          </div>
        )}
      </td>
      <td
        className="px-3 py-2 font-mono text-xs whitespace-nowrap theme-text"
      >
        {formatPLS(tx.valuePLS, symbol)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <TxGasInfo
          type={tx.type}
          gasPrice={tx.gasPrice}
          maxFeePerGas={tx.maxFeePerGas}
          maxPriorityFeePerGas={tx.maxPriorityFeePerGas}
        />
      </td>
      <td className="px-3 py-2">
        <Tooltip label={tx.isError === "0" ? "Success" : "Error"}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              backgroundColor:
                tx.isError === "0"
                  ? "var(--color-success)"
                  : "var(--color-danger)",
            }}
          />
        </Tooltip>
      </td>
      <td className="px-3 py-2 text-right relative">
        <TxRowActions
          hash={tx.hash}
          contractAddress={isContractCreation ? null : tx.to}
          compact
        />
      </td>
    </tr>
  );
}

function LinkButton({
  target,
  onNavigate,
  title,
  children,
}: {
  target: AddressNavTarget;
  onNavigate: (target: AddressNavTarget) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <ExplorerLink
      target={target}
      onNavigate={onNavigate}
      title={title}
      className="font-mono text-xs hover:underline cursor-pointer theme-accent"
    >
      {children}
    </ExplorerLink>
  );
}

function DirectionBadge({ isIn }: { isIn: boolean }) {
  return (
    <span
      className="text-[9px] font-bold px-1 py-0.5 rounded"
      style={{
        backgroundColor: isIn
          ? "var(--color-success-muted)"
          : "var(--color-warning-muted)",
        color: isIn ? "var(--color-success)" : "var(--color-warning)",
      }}
    >
      {isIn ? "IN" : "OUT"}
    </span>
  );
}
