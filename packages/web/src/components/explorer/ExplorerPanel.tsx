import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { Icon } from "@iconify/react";
import TxDetail from "./TxDetail";
import AddressView from "./AddressView";
import BlockView from "./BlockView";
import ContractView from "./ContractView";
import ExplorerHome from "./ExplorerHome";
import MultiChainAddressView from "./MultiChainAddressView";
import BlockHeightView from "./BlockHeightView";
import { recordVisit } from "../../lib/recentEntities";
import { useResolvedChainRedirect } from "../../lib/useResolvedChainRedirect";
import { scanPath } from "../../lib/scanRoutes";
import { stripChainPrefix } from "../../lib/chainScope";
import { useChainScope } from "../../lib/activeChain";
import { truncateAddr } from "./format";
import { Tooltip } from "../primitives/Tooltip";

type ExplorerView =
  | { type: "none" }
  | { type: "tx"; hash: string }
  | { type: "address"; address: string }
  | { type: "block"; numberOrHash: string }
  | { type: "contract"; address: string };

/**
 * EIP-3091 path for a view; "none" is the explorer home.
 *
 * `chainId` is the page's own scope, or `undefined` on an all-chain page. A
 * link built from a scoped page keeps that scope, so an internal click never
 * pays for a needless four-chain resolve fan-out. A link built from an
 * all-chain page stays bare — the user has not picked a chain yet.
 */
function pathForView(v: ExplorerView, chainId: number | undefined): string {
  switch (v.type) {
    case "tx":
      return scanPath("tx", v.hash, chainId);
    case "address":
      return scanPath("address", v.address, chainId);
    case "contract":
      return scanPath("contract", v.address, chainId);
    case "block":
      return scanPath("block", v.numberOrHash, chainId);
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
    // Strip a chain-scoped prefix first. Under /eip155/369/tx/0x… the full
    // pathname never starts with "/tx/", so the checks below need the path
    // WITHOUT the prefix to match at all.
    const p = stripChainPrefix(location.pathname);
    if (p.startsWith("/tx/") && params.hash) return { type: "tx", hash: params.hash };
    if (p.startsWith("/block/") && params.id) return { type: "block", numberOrHash: params.id };
    if (p.startsWith("/token/") && params.address) return { type: "contract", address: params.address };
    if (p.startsWith("/address/") && params.address) return { type: "address", address: params.address };
    return { type: "none" };
  }, [location.pathname, params.hash, params.id, params.address]);

  // EIP-3091 paths are the shareable surface of this app, and they carry no
  // chain — so /tx/<a 943 hash> resolved to PulseChain and 404'd on a
  // transaction that loads fine one chain over. Same defect the debugger had.
  // Point the URL at the chain the entity lives on before the child view
  // fetches. A bare block NUMBER stays put by construction: it exists on every
  // chain past that height, so the resolve matches 369 and no redirect fires.
  const resolveQuery = useMemo<string | null>(() => {
    switch (view.type) {
      case "tx":
        return view.hash;
      case "address":
      case "contract":
        return view.address;
      case "block":
        return view.numberOrHash;
      case "none":
        return null;
    }
  }, [view]);
  const scope = useChainScope();
  // A bare block NUMBER is not chain-locatable; a block HASH is. Only the
  // number form gets the all-chain treatment.
  const isBlockNumber = view.type === "block" && /^\d+$/.test(view.numberOrHash);
  // Neither an address/contract nor an all-chain block number has one right
  // chain to resolve to — an address is valid on every chain, and a bare
  // block number exists on every chain past that height. Skip the resolve
  // for both: `BlockHeightView` below already fans the block number out
  // across every chain itself, so resolving it here first would fan out
  // twice for the one case the design says should cost one fan-out.
  const skipResolve =
    view.type === "address" ||
    view.type === "contract" ||
    (scope.kind === "all" && isBlockNumber);
  const resolvingChain =
    useResolvedChainRedirect(resolveQuery, skipResolve ? "skip" : "entity") === "resolving";
  // Every chain, shown at once, only for a chain-less address or contract
  // page. A scoped page (an explicit chain, or a tx/block page) keeps the
  // single-chain view below.
  const showAllChains =
    scope.kind === "all" && (view.type === "address" || view.type === "contract");
  const scopedChainId = scope.kind === "one" ? scope.chainId : undefined;

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
      navigate(pathForView(newView, scopedChainId), {
        state: { trail: view.type !== "none" ? [...trail, view] : trail },
      });
    },
    [navigate, view, trail, scopedChainId],
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
      navigate(pathForView(target, scopedChainId), { state: { trail: trail.slice(0, index) } });
    },
    [navigate, trail, scopedChainId],
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

  // Terminal: an all-chain address/contract page renders every chain and
  // never resolves to one, so it skips the breadcrumb + single-chain views
  // below entirely. Both view shapes carry `.address`, so one branch serves
  // both.
  if (showAllChains && (view.type === "address" || view.type === "contract")) {
    return <MultiChainAddressView address={view.address} />;
  }

  if (scope.kind === "all" && isBlockNumber && view.type === "block") {
    return <BlockHeightView height={view.numberOrHash} />;
  }

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
      {/* No onNavigate: its rows are real <Link>s now, so they can be
          middle-clicked and copied like any other link. */}
      {view.type === "none" && <ExplorerHome />}

      {/* Hold the entity views until the chain is settled — otherwise each one
          fires its fetch against the default chain first and renders a
          "not found" that the redirect then has to undo. */}
      {resolvingChain && <ResolvingChainPanel />}

      {!resolvingChain && view.type === "tx" && (
        <TxDetail hash={view.hash} onNavigate={handleNavigate} />
      )}

      {!resolvingChain && view.type === "address" && (
        <AddressView address={view.address} onNavigate={handleNavigate} />
      )}

      {!resolvingChain && view.type === "block" && (
        <BlockView
          numberOrHash={view.numberOrHash}
          onNavigate={handleNavigate}
        />
      )}

      {!resolvingChain && view.type === "contract" && (
        <ContractView address={view.address} onNavigate={handleNavigate} />
      )}
    </div>
  );
}

/**
 * Shown while `/api/resolve` decides which chain a chain-less deep link points
 * at. Mirrors TxDetail's own loading panel so the handoff between the two is
 * seamless rather than a visible swap.
 */
function ResolvingChainPanel() {
  return (
    <div className="rounded-lg bs p-8 flex flex-col items-center justify-center min-h-[300px] theme-card-bg">
      <div className="spinner mb-3" />
      <span className="text-sm theme-text-secondary">Finding chain...</span>
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
        <Tooltip label="Back">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex items-center justify-center w-6 h-6 mr-1 transition-colors hover:opacity-100 theme-text-muted"
            style={{ backgroundColor: "transparent" }}
          >
            <Icon icon="heroicons:chevron-left" className="w-4 h-4" />
          </button>
        </Tooltip>
      )}

      {collapsed.map((node, i) => (
        <span key={node.key} className="flex items-center gap-tight">
          {i > 0 && (
            <Icon icon="heroicons:chevron-right" className="w-3.5 h-3.5 theme-text-muted" aria-hidden />
          )}
          {/* Insert the "…" expander right after Home when collapsed. */}
          {hasGap && i === 1 && (
            <>
              <Tooltip label="Show full trail">
                <button
                  onClick={() => setExpanded(true)}
                  className="px-1.5 py-1 font-mono transition-colors hover:opacity-100 theme-text-muted"
                  style={{ backgroundColor: "transparent" }}
                >
                  …
                </button>
              </Tooltip>
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
