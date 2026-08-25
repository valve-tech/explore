import EntityRow from "../../primitives/EntityRow";
import { Skeleton } from "../../primitives/Skeleton";
import { EmptyState } from "../../primitives/EmptyState";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";
import { TxGasInfo } from "../TxGasInfo";
import { scanPath } from "../../../lib/scanRoutes";
import { chainSymbol } from "../../../lib/chains";
import type { RecentTx } from "../../../api/latest";
import { formatBlockNum, formatNative } from "./formatters";

/**
 * Recent transactions, one EntityRow each.
 *
 * The row this replaces had three lines — hash, method, then a fee readout —
 * and `EntityRow`'s own doc says two, never three, because a third line buries
 * the comparison a list exists to support. Method and fee now share the
 * subline.
 *
 * The right column shows the block instead of an age. Every transaction in
 * this list arrives from the same block or its neighbour, so the age column
 * read "9s ago" eight rows running: ten repetitions of one fact. The block
 * number was already on the wire and rendered nowhere, and it is the thing a
 * developer actually wants next — it says which block included this, and
 * whether two transactions landed together.
 *
 * The method is NOT truncated. It used to carry `truncate`, which clips a
 * selector or a function name mid-word; rule 10 reserves that for nothing a
 * reader needs whole, and a method name is the row's most legible fact.
 */
export function TxList({
  txs,
  chainId,
  loading,
}: {
  txs: RecentTx[];
  chainId: number;
  loading: boolean;
}) {
  const symbol = chainSymbol(chainId);

  if (loading && txs.length === 0) {
    return (
      <div className="flex flex-col gap-px">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[46px]" />
        ))}
      </div>
    );
  }

  if (txs.length === 0) {
    return (
      <EmptyState
        icon="heroicons:arrow-path"
        title="No transactions yet"
        subtitle="Recent blocks on this chain carried none."
      />
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {txs.map((t) => (
        <EntityRow
          key={t.hash}
          href={scanPath("tx", t.hash, chainId)}
          ariaLabel={`Transaction ${t.hash}`}
          main={
            <span className="theme-mono theme-accent">
              <MiddleTruncate value={t.hash} tailChars={6} className="max-w-full" />
            </span>
          }
          sub={
            <span className="flex items-center gap-inline min-w-0">
              <span className="break-all min-w-0">
                {t.methodName ? `${t.methodName}()` : t.methodId || "transfer"}
              </span>
              <TxGasInfo
                type={t.type}
                gasPrice={t.gasPrice}
                maxFeePerGas={t.maxFeePerGas}
                maxPriorityFeePerGas={t.maxPriorityFeePerGas}
              />
            </span>
          }
          right={`${formatNative(t.value)} ${symbol}`}
          rightSub={`#${formatBlockNum(t.blockNumber)}`}
        />
      ))}
    </div>
  );
}
