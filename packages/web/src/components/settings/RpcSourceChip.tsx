import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useActiveChainId } from "../../lib/activeChain";
import { isRpcOverridden } from "../../lib/rpcEndpoint";
import { chainById } from "../../lib/chains";
import { Tooltip } from "../primitives/Tooltip";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { RpcChainRow } from "./RpcChainRow";
import { InfoButton, FactList } from "./InfoDisclosure";
import { RPC_FACTS } from "./rpcFacts";

/**
 * Top-bar chip that surfaces — and quickly changes — where the active chain's
 * raw reads go: "your node" (a per-chain BYO-RPC override is set) or "Explore
 * backend" (the default). It makes the otherwise-buried Settings knob
 * discoverable and one-click reachable from anywhere in the app.
 *
 * The label is derived from `isRpcOverridden(activeChainId)` on each render, so
 * it tracks route changes (the active chain comes from `?chainid`); a quick edit
 * in the popover bumps a counter to re-read the (non-reactive) localStorage value
 * immediately. The popover reuses the same `RpcChainRow` the Settings panel uses,
 * so the two never drift.
 *
 * The popover closes on an outside click, on Escape, and on a route change.
 * It stores the route it opened on and is open only while that route is
 * current, so a navigation closes it with no effect and no ref.
 */
export function RpcSourceChip() {
  const chainId = useActiveChainId();
  const chain = chainById(chainId);
  const chainName = chain?.name ?? `Chain ${chainId}`;
  const { pathname, search } = useLocation();
  const route = `${pathname}${search}`;
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === route;
  const setOpen = (next: boolean) => setOpenOn(next ? route : null);
  const [showFacts, setShowFacts] = useState(false);
  // localStorage isn't reactive — bump to re-derive the label after a quick edit.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenOn(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const overridden = isRpcOverridden(chainId);
  const isMobile = useIsMobile();

  return (
    <div ref={ref} className="relative inline-flex">
      <Tooltip
        // The top bar has no room above the chip, so the label opens below.
        side={isMobile ? "top" : "bottom"}
        label={
          open
            ? null
            : overridden
              ? `${chainName} reads go to your node`
              : `${chainName} reads go through Explore's backend`
        }
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-tight px-2.5 h-8 text-xs font-medium theme-tertiary-bg theme-text-secondary"
        >
          <Icon
            icon="heroicons:bolt"
            className={`w-3.5 h-3.5 ${overridden ? "theme-accent" : "theme-text-muted"}`}
          />
          <span>
            {overridden ? "your node" : "backend"}
          </span>
          <Icon
            icon={open ? "heroicons:chevron-up" : "heroicons:chevron-down"}
            className="w-3 h-3 theme-text-muted"
          />
        </button>
      </Tooltip>

      {/*
       * From `sm` up the chip sits in the top bar, so the popover opens
       * below it. On a phone the chip sits at the foot of the drawer, so the
       * popover opens above it and fits the viewport.
       */}
      {open && (
        <div className="absolute z-20 max-sm:bottom-full max-sm:left-0 max-sm:mb-1 sm:top-full sm:right-0 sm:mt-1 w-[min(26rem,calc(100vw-2.5rem))] p-2 sm:p-4 theme-card-bg bs flex flex-col gap-row">
          <div className="flex items-center justify-between gap-inline">
            <div className="flex items-center gap-inline text-xs uppercase tracking-widest theme-text-muted min-w-0">
              <Icon icon="heroicons:bolt" className="w-3.5 h-3.5 shrink-0" />
              <span>RPC source · {chainName}</span>
            </div>
            <InfoButton open={showFacts} onToggle={() => setShowFacts((s) => !s)} />
          </div>
          {showFacts && <FactList facts={RPC_FACTS} />}
          <RpcChainRow
            chainId={chainId}
            name={chainName}
            showName={false}
            onChange={() => bump()}
          />
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-tight self-start text-xs theme-accent hover:opacity-80"
          >
            <Icon icon="heroicons:adjustments-horizontal" className="w-3.5 h-3.5" />
            All chains &amp; settings
          </Link>
        </div>
      )}
    </div>
  );
}
