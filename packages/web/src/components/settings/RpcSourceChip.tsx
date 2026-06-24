import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useActiveChainId } from "../../lib/activeChain";
import { isRpcOverridden } from "../../lib/rpcEndpoint";
import { chainById } from "../../lib/chains";
import { Tooltip } from "../primitives/Tooltip";
import { RpcChainRow } from "./RpcChainRow";

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
 */
export function RpcSourceChip() {
  const chainId = useActiveChainId();
  const chain = chainById(chainId);
  const chainName = chain?.name ?? `Chain ${chainId}`;
  const [open, setOpen] = useState(false);
  // localStorage isn't reactive — bump to re-derive the label after a quick edit.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const overridden = isRpcOverridden(chainId);

  return (
    <div ref={ref} className="relative inline-flex">
      <Tooltip
        label={
          overridden
            ? `${chainName} reads go to your node`
            : `${chainName} reads go through Explore's backend`
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-tight px-2.5 h-8 text-xs font-medium theme-tertiary-bg theme-text-secondary"
        >
          <Icon
            icon="heroicons:bolt"
            className={`w-3.5 h-3.5 ${overridden ? "theme-accent" : "theme-text-muted"}`}
          />
          <span className="hidden sm:inline">
            {overridden ? "your node" : "backend"}
          </span>
          <Icon
            icon={open ? "heroicons:chevron-up" : "heroicons:chevron-down"}
            className="w-3 h-3 theme-text-muted"
          />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute z-20 top-full right-0 mt-1 w-[320px] p-3 theme-card-bg bs space-y-stack">
          <div className="flex items-center gap-inline text-xs uppercase tracking-widest theme-text-muted">
            <Icon icon="heroicons:bolt" className="w-3.5 h-3.5" />
            RPC source · {chainName}
          </div>
          <p className="text-xs theme-text-muted">
            Set a node URL to read this chain straight from your own
            infrastructure; leave it empty to use Explore&apos;s backend.
          </p>
          <RpcChainRow chainId={chainId} name={chainName} onChange={() => bump()} />
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-tight text-xs theme-accent hover:opacity-80"
          >
            <Icon icon="heroicons:adjustments-horizontal" className="w-3.5 h-3.5" />
            All chains &amp; settings
          </Link>
        </div>
      )}
    </div>
  );
}
