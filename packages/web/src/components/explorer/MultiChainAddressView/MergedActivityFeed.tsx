import EntityRow from "../../primitives/EntityRow";
import { chainById, chainLogoUrl } from "../../../lib/chains";
import { scanPath } from "../../../lib/scanRoutes";
import { truncateAddr } from "../format";
import type { MergedActivity } from "../../../api/multichain";

/**
 * The merged recent-activity feed.
 *
 * This is a WINDOW, not a paginated list, and the footer says so. Paging deeper
 * across chains needs per-chain cursors and a total nobody can compute cheaply,
 * so the footer sends the user to one chain rather than faking a page count.
 *
 * A chain the backend could not reach is named in the footer. Dropping it
 * silently would read as "no activity there", which is a different claim from
 * "we could not look".
 *
 * The footer's reachable-chain links and excluded chips sit inside one `nav`
 * landmark, labelled to match the footer's own "page deeper" text. A test can
 * then query within that landmark instead of matching plain text against the
 * whole page — the row subline and the footer both name the same chain, and a
 * page-wide text query cannot tell those two apart.
 */
interface Props {
  address: string;
  activity: MergedActivity;
}

export default function MergedActivityFeed({ address, activity }: Props) {
  const { rows, perChain } = activity;
  const reachable = perChain.filter((p) => !p.error);
  const excluded = perChain.filter((p) => p.error);

  if (rows.length === 0) {
    return (
      <p className="p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]">
        No recent activity on any chain we could reach.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {rows.map((row) => {
        const chain = chainById(row.chainId);
        // `getAddressTransactions` names this field `functionName`. The
        // selector lookup can fail, and a plain native transfer has no
        // selector at all — both leave it "".
        const functionName = row.functionName;
        const method = typeof functionName === "string" && functionName !== ""
          ? functionName
          : "transaction";
        return (
          <EntityRow
            key={`${row.chainId}-${row.hash}`}
            href={scanPath("tx", row.hash, row.chainId)}
            main={method}
            sub={`${chain?.name ?? row.chainId} · ${truncateAddr(row.hash)}`}
            right={relativeAge(row.timeStamp)}
          />
        );
      })}

      <nav
        aria-label="Page deeper on one chain"
        className="flex flex-wrap items-center justify-between gap-inline p-2 theme-text-muted theme-mono text-xs shadow-[0_0_0_1px_var(--color-border-muted)]"
      >
        <span>Page deeper on one chain</span>
        <span className="flex flex-wrap gap-inline">
          {reachable.map((p) => (
            <a
              key={p.chainId}
              href={scanPath("address", address, p.chainId)}
              className="theme-accent rounded px-2 py-0.5 shadow-[0_0_0_1px_var(--color-border-default)] inline-flex items-center gap-tight"
            >
              <ChainIcon chainId={p.chainId} />
              {chainById(p.chainId)?.name ?? p.chainId} →
            </a>
          ))}
          {excluded.map((p) => (
            <span key={p.chainId} className="px-2 py-0.5 theme-warning inline-flex items-center gap-tight">
              <ChainIcon chainId={p.chainId} />
              {chainById(p.chainId)?.name ?? p.chainId} excluded ⚠
            </span>
          ))}
        </span>
      </nav>
    </div>
  );
}

/**
 * Small chain badge next to each footer entry's name. `alt` is empty because
 * the visible name right beside it already identifies the chain — a screen
 * reader must not read the name twice.
 */
function ChainIcon({ chainId }: { chainId: number }) {
  return (
    <img
      src={chainLogoUrl(chainId)}
      alt=""
      width={14}
      height={14}
      className="size-[14px] shrink-0 rounded-full"
    />
  );
}

/** Unix seconds → a short relative age. Pure, so it is directly testable. */
export function relativeAge(timeStamp: string, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - Number(timeStamp));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
