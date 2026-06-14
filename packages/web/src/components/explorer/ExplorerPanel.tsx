import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { Icon } from "@iconify/react";
import TxDetail from "./TxDetail";
import AddressView from "./AddressView";
import BlockView from "./BlockView";
import ContractView from "./ContractView";
import ExplorerHome from "./ExplorerHome";
import { recordVisit } from "../../lib/recentEntities";
import { scanPath } from "../../lib/scanRoutes";
import { truncateAddr } from "./format";

type ExplorerView =
  | { type: "none" }
  | { type: "tx"; hash: string }
  | { type: "address"; address: string }
  | { type: "block"; numberOrHash: string }
  | { type: "contract"; address: string };

/** EIP-3091 path for a view; "none" is the explorer home. */
function pathForView(v: ExplorerView): string {
  switch (v.type) {
    case "tx":
      return scanPath("tx", v.hash);
    case "address":
      return scanPath("address", v.address);
    case "contract":
      return scanPath("contract", v.address);
    case "block":
      return scanPath("block", v.numberOrHash);
    case "none":
      return "/explorer";
  }
}

export default function ExplorerPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ hash?: string; id?: string; address?: string }>();

  // The URL is the source of truth — /tx/<h>, /block/<n>, /address/<a>,
  // /token/<a> (EIP-3091). Driving off the path makes back/forward, reload,
  // and link-sharing all work.
  const view = useMemo<ExplorerView>(() => {
    const p = location.pathname;
    if (p.startsWith("/tx/") && params.hash) return { type: "tx", hash: params.hash };
    if (p.startsWith("/block/") && params.id) return { type: "block", numberOrHash: params.id };
    if (p.startsWith("/token/") && params.address) return { type: "contract", address: params.address };
    if (p.startsWith("/address/") && params.address) return { type: "address", address: params.address };
    return { type: "none" };
  }, [location.pathname, params.hash, params.id, params.address]);

  // The breadcrumb trail rides in history state, so back/forward restore it.
  const trail = useMemo<ExplorerView[]>(
    () => (location.state as { trail?: ExplorerView[] } | null)?.trail ?? [],
    [location.state],
  );

  useEffect(() => {
    if (view.type === "tx") recordVisit({ kind: "tx", value: view.hash });
    else if (view.type === "address") recordVisit({ kind: "address", value: view.address });
    else if (view.type === "contract") recordVisit({ kind: "contract", value: view.address });
    else if (view.type === "block") recordVisit({ kind: "block", value: view.numberOrHash });
  }, [view]);

  const navigateTo = useCallback(
    (newView: ExplorerView) => {
      navigate(pathForView(newView), {
        state: { trail: view.type !== "none" ? [...trail, view] : trail },
      });
    },
    [navigate, view, trail],
  );

  const goBack = useCallback(() => navigate(-1), [navigate]);

  // Jump to a node in the breadcrumb trail (index into `trail`); -1 is Home.
  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0) {
        navigate("/explorer", { state: { trail: [] } });
        return;
      }
      const target = trail[index];
      if (!target) return;
      navigate(pathForView(target), { state: { trail: trail.slice(0, index) } });
    },
    [navigate, trail],
  );

  const handleNavigate = (target: {
    type: "tx" | "address" | "block" | "contract";
    value: string;
  }) => {
    switch (target.type) {
      case "tx":
        navigateTo({ type: "tx", hash: target.value });
        break;
      case "address":
        navigateTo({ type: "address", address: target.value });
        break;
      case "block":
        navigateTo({ type: "block", numberOrHash: target.value });
        break;
      case "contract":
        navigateTo({ type: "contract", address: target.value });
        break;
    }
  };

  return (
    <div className="space-y-stack">
      {/* Breadcrumb trail — every node is a one-click jump. */}
      {view.type !== "none" && (
        <Breadcrumb
          view={view}
          history={trail}
          onJump={jumpTo}
          onBack={goBack}
        />
      )}

      {/* Home view — latest summary, recent blocks, recent txs */}
      {view.type === "none" && <ExplorerHome onNavigate={handleNavigate} />}

      {view.type === "tx" && (
        <TxDetail hash={view.hash} onNavigate={handleNavigate} />
      )}

      {view.type === "address" && (
        <AddressView address={view.address} onNavigate={handleNavigate} />
      )}

      {view.type === "block" && (
        <BlockView
          numberOrHash={view.numberOrHash}
          onNavigate={handleNavigate}
        />
      )}

      {view.type === "contract" && (
        <ContractView address={view.address} onNavigate={handleNavigate} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Breadcrumb                                                         */
/* ------------------------------------------------------------------ */

function viewLabel(v: ExplorerView): string {
  switch (v.type) {
    case "tx":
      return truncateAddr(v.hash);
    case "address":
    case "contract":
      return truncateAddr(v.address);
    case "block":
      return v.numberOrHash.startsWith("0x")
        ? truncateAddr(v.numberOrHash)
        : `#${v.numberOrHash}`;
    case "none":
      return "Home";
  }
}

/** Number of nodes (incl. Home + current) shown before the middle collapses. */
const CRUMB_VISIBLE = 4;

/**
 * Clickable trail over the explorer's internal history stack. `history` holds
 * the views behind the current one; the breadcrumb renders Home → …history →
 * current, collapsing the middle when the trail grows long.
 */
function Breadcrumb({
  view,
  history,
  onJump,
  onBack,
}: {
  view: ExplorerView;
  history: ExplorerView[];
  onJump: (index: number) => void;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Build the full node list: Home (index -1), each history view (its index),
  // then the current view (index history.length, non-clickable).
  const nodes = [
    { key: "home", label: "Home", kind: null as string | null, index: -1, current: false },
    ...history.map((v, i) => ({
      key: `h${i}`,
      label: viewLabel(v),
      kind: v.type,
      index: i,
      current: false,
    })),
    {
      key: "cur",
      label: viewLabel(view),
      kind: view.type,
      index: history.length,
      current: true,
    },
  ];

  // Collapse the middle when long: keep Home + last (CRUMB_VISIBLE-1) nodes.
  const collapsed =
    !expanded && nodes.length > CRUMB_VISIBLE + 1
      ? [nodes[0]!, ...nodes.slice(nodes.length - CRUMB_VISIBLE)]
      : nodes;
  const hasGap = collapsed.length < nodes.length;

  return (
    <nav
      className="flex items-center gap-tight flex-wrap text-xs"
      aria-label="Explorer trail"
    >
      {history.length > 0 && (
        <button
          onClick={onBack}
          title="Back"
          aria-label="Back"
          className="flex items-center justify-center w-6 h-6 mr-1 transition-colors hover:opacity-100 theme-text-muted"
          style={{ backgroundColor: "transparent" }}
        >
          <Icon icon="heroicons:chevron-left" className="w-4 h-4" />
        </button>
      )}

      {collapsed.map((node, i) => (
        <span key={node.key} className="flex items-center gap-tight">
          {i > 0 && (
            <Icon icon="heroicons:chevron-right" className="w-3.5 h-3.5 theme-text-muted" aria-hidden />
          )}
          {/* Insert the "…" expander right after Home when collapsed. */}
          {hasGap && i === 1 && (
            <>
              <button
                onClick={() => setExpanded(true)}
                title="Show full trail"
                className="px-1.5 py-1 font-mono transition-colors hover:opacity-100 theme-text-muted"
                style={{ backgroundColor: "transparent" }}
              >
                …
              </button>
              <Icon icon="heroicons:chevron-right" className="w-3.5 h-3.5 theme-text-muted" aria-hidden />
            </>
          )}
          <CrumbNode node={node} onJump={onJump} />
        </span>
      ))}
    </nav>
  );
}

function CrumbNode({
  node,
  onJump,
}: {
  node: { label: string; kind: string | null; index: number; current: boolean };
  onJump: (index: number) => void;
}) {
  const content = (
    <span className="flex items-center gap-tight font-mono px-2 py-1">
      {node.kind && node.kind !== "none" && (
        <span
          className="text-[9px] uppercase tracking-wider not-italic theme-text-muted"
        >
          {node.kind}
        </span>
      )}
      {node.label}
    </span>
  );

  if (node.current) {
    return (
      <span
        aria-current="page"
        className="theme-text theme-tertiary-bg bs-in-muted"
      >
        {content}
      </span>
    );
  }

  return (
    <button
      onClick={() => onJump(node.index)}
      className="transition-colors hover:opacity-100 cursor-pointer theme-text-secondary"
      style={{ backgroundColor: "transparent" }}
    >
      {content}
    </button>
  );
}
