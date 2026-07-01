import { Link, useParams } from "react-router-dom";
import { Icon } from "@iconify/react";
import { FeeLadder } from "../components/networkHealth/FeeLadder";
import { useActiveChainId } from "../lib/activeChain";
import { chainById, DEFAULT_CHAIN_ID } from "../lib/chains";

/**
 * Standalone, shareable network-health view for ONE block — the fee ladder at a
 * stable URL (`/network-health/block/:number[?chainid=N]`), so a single block
 * can be linked directly instead of only expanding inline in the window table.
 * Reuses <FeeLadder>, which fetches + renders the per-tx tip-by-position graph.
 */
export default function NetworkHealthBlockPage() {
  const { number } = useParams<{ number: string }>();
  const chainId = useActiveChainId();
  const chainName = chainById(chainId)?.name ?? `chain ${chainId}`;
  // Preserve the active chain on internal links (default chain omits the param,
  // matching the rest of the app's URL scheme).
  const q = chainId === DEFAULT_CHAIN_ID ? "" : `?chainid=${chainId}`;

  const valid = !!number && /^\d+$/.test(number);

  return (
    <div className="space-y-section p-4">
      <header className="space-y-stack">
        <div className="flex flex-wrap items-center justify-between gap-row">
          <div className="flex items-baseline gap-row">
            <h1 className="text-xl theme-text">Block #{number}</h1>
            <span className="text-sm theme-text-muted">{chainName} · network health</span>
          </div>
          <div className="flex flex-wrap items-center gap-row text-sm">
            <Link
              to={`/network-health${q}`}
              className="inline-flex items-center gap-tight theme-text-muted hover:theme-text"
            >
              <Icon icon="heroicons:arrow-left" className="w-4 h-4" />
              All blocks
            </Link>
            {valid && (
              <Link
                to={`/block/${number}${q}`}
                className="inline-flex items-center gap-tight theme-text-muted hover:theme-text"
              >
                <Icon icon="heroicons:cube" className="w-4 h-4" />
                View in explorer
              </Link>
            )}
          </div>
        </div>
        <p className="text-sm theme-text-secondary">
          Fee ladder for this block — each transaction's tip by position, with
          queue-jumps highlighted.
        </p>
      </header>

      {valid ? (
        <div className="card">
          <FeeLadder blockNumber={number} />
        </div>
      ) : (
        <div className="card p-4 text-sm theme-danger">
          "{number}" isn't a valid block number.
        </div>
      )}
    </div>
  );
}
