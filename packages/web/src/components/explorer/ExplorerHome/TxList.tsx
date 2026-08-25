import EntityRow from "../../primitives/EntityRow";
import { Skeleton } from "../../primitives/Skeleton";
import { EmptyState } from "../../primitives/EmptyState";
import { MiddleTruncate } from "../../primitives/MiddleTruncate";
import { MethodName } from "../MethodName";
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
 * The fee readout is NOT here, and that is a deliberate subtraction. It was
 * the noisiest thing on the page — "tip 3,922,697.967 / cap 3,922,697.967
 * gwei" under every row, the same number printed twice on six rows in ten —
 * and it does not survive a two-line row. Putting it beside the method inside
 * `EntityRow`'s subline made the two OVERLAP: `truncate` sets `white-space:
 * nowrap` on that span, so a flex child set to `break-all` collapses to
 * nothing and spills its text across its neighbour rather than wrapping. One
 * line holds one thing. The exact fees are on the transaction page, which is
 * one click away and is where someone comparing them is going anyway.
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
            /*
             * `whitespace-normal` overrides the nowrap that `EntityRow`'s main
             * line inherits from `truncate`. Below `sm:`, `MiddleTruncate`
             * deliberately WRAPS the full hash instead of middle-clipping it —
             * text that reflows cannot force horizontal scroll — and a nowrap
             * parent stops it doing that, so a 66-character hash ran 196px
             * past the content pane at 375px instead of taking a second line.
             */
            <span className="theme-mono theme-accent whitespace-normal min-w-0">
              <MiddleTruncate value={t.hash} tailChars={6} className="max-w-full" />
            </span>
          }
          sub={
            t.methodName ? (
              <MethodName
                label={`${t.methodName}()`}
                selector={t.methodId}
                candidates={t.methodCandidates}
              />
            ) : (
              t.methodId || "transfer"
            )
          }
          right={`${formatNative(t.value)} ${symbol}`}
          rightSub={`#${formatBlockNum(t.blockNumber)}`}
        />
      ))}
    </div>
  );
}
