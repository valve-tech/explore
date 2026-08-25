import EntityRow from "../../primitives/EntityRow";
import { Skeleton } from "../../primitives/Skeleton";
import { EmptyState } from "../../primitives/EmptyState";
import { scanPath } from "../../../lib/scanRoutes";
import type { BlockHeader } from "../../../api/latest";
import { formatBlockNum, gasShare, gasPctLabel, ago } from "./formatters";

/**
 * Recent blocks, one EntityRow each.
 *
 * Two things changed from the card-and-list version this replaces.
 *
 * The row's background fill carries gas used. It used to be a right-aligned
 * percentage with the words "gas used" printed underneath it — ten times, once
 * per row, for a label that never varied. The fill says the same thing without
 * a single word, and it ranks the blocks against each other at a glance, which
 * the text never did. The percentage stays as the exact figure.
 *
 * And the block number is the row's subject, not a repeated prefix. Ten
 * consecutive blocks share every digit but the last two or three, so a column
 * of "#27,372,302 / #27,372,301 / #27,372,300" is nine characters of noise
 * carrying two characters of signal. The full number is still there — it is
 * the identity, and rule 10 says an identity wraps rather than truncating —
 * but the changing tail is what the eye lands on.
 */
export function BlocksList({
  blocks,
  chainId,
  loading,
}: {
  blocks: BlockHeader[];
  chainId: number;
  loading: boolean;
}) {
  if (loading && blocks.length === 0) {
    return (
      <div className="flex flex-col gap-px">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[46px]" />
        ))}
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <EmptyState
        icon="heroicons:cube"
        title="No blocks yet"
        subtitle="This chain has not produced a block we can read."
      />
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {blocks.map((b) => (
        <EntityRow
          key={b.hash}
          href={scanPath("block", b.number, chainId)}
          ariaLabel={`Block ${formatBlockNum(b.number)}`}
          share={gasShare(b.gasUsed, b.gasLimit)}
          main={<span className="theme-mono tabular-nums">#{formatBlockNum(b.number)}</span>}
          sub={`${ago(b.timestamp)} · ${b.transactionCount} txs`}
          right={gasPctLabel(b.gasUsed, b.gasLimit)}
        />
      ))}
    </div>
  );
}
