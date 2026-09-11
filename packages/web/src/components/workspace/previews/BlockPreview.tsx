import { useQuery } from "@tanstack/react-query";
import { fetchBlock } from "../../../api/explorer";
import { PreviewShell, shortHex } from "./PreviewShell";
import Timestamp from "../../primitives/Timestamp";

/**
 * Compact summary of a block. Confirmed blocks are immutable; `staleTime:
 * Infinity` is safe. `chainId` is the item's pinned chain (see AddressPreview).
 */
export function BlockPreview({
  numberOrHash,
  chainId,
}: {
  numberOrHash: string;
  chainId: number;
}) {
  const query = useQuery({
    queryKey: ["workspace-preview-block", chainId, numberOrHash.toLowerCase()],
    queryFn: () => fetchBlock(numberOrHash, chainId),
    staleTime: Infinity,
  });

  if (query.isLoading) {
    return <PreviewShell loading facts={[]} />;
  }
  if (query.error) {
    return <PreviewShell error="Couldn't load block preview." facts={[]} />;
  }
  if (!query.data) return null;

  const b = query.data;
  const gasPct = b.gasLimit !== "0"
    ? `${((Number(b.gasUsed) / Number(b.gasLimit)) * 100).toFixed(1)}%`
    : null;

  return (
    <PreviewShell
      facts={[
        { label: "Number", value: Number(b.number).toLocaleString(), mono: true },
        { label: "Txs", value: b.transactionCount.toLocaleString() },
        { label: "Miner", value: shortHex(b.miner), mono: true },
        { label: "Gas used", value: gasPct, mono: true },
      ]}
      footer={
        <>
          mined <Timestamp ts={b.timestamp} />
        </>
      }
    />
  );
}
