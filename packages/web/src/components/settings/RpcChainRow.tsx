import { useEffect, useState } from "react";
import {
  getRpcOverride,
  setRpcOverride,
  clearRpcOverride,
} from "../../lib/rpcEndpoint";
import { VALVE_PUBLIC_RPC } from "../../lib/rpcDefaults";
import type { RpcChoice } from "../../lib/rpcSuggestions";
import { RpcAlternatives } from "./RpcAlternatives";
import { EndpointUrl } from "./EndpointUrl";
import { OverrideField } from "./OverrideField";

/**
 * One chain's bring-your-own-RPC override editor: names the endpoint the
 * browser will actually call, and lets the user set or clear a per-chain
 * override. Used both in the full Settings panel and in the top-bar RPC chip's
 * quick popover, so the two stay in lockstep.
 *
 * The source label reads "your node" or "Valve public node" — not "Explore
 * backend". The backend serves the app's ENRICHED reads; it is not an RPC
 * endpoint and never appears in this field. What goes here is where the
 * browser's own chain calls go, which is Valve's public node by default.
 *
 * `onChange` fires with the newly-stored URL (or null on clear) so a host that
 * mirrors the source label (the chip) can update without re-reading storage.
 */
export function RpcChainRow({
  chainId,
  name,
  showName = true,
  onChange,
}: {
  chainId: number;
  name: string;
  /** False when the host already names the chain, as the top-bar popover does. */
  showName?: boolean;
  onChange?: (stored: string | null) => void;
}) {
  const [draft, setDraft] = useState(() => getRpcOverride(chainId) ?? "");
  const [stored, setStored] = useState<string | null>(() =>
    getRpcOverride(chainId),
  );
  const [error, setError] = useState<string | null>(null);

  // Derived in render from `stored`, so Set/Clear update the display without
  // a second source of truth. Never a ref, never an effect.
  const effective = stored ?? VALVE_PUBLIC_RPC[chainId];

  /*
   * The suggestion list arrives by dynamic import. This row renders inside
   * the top bar's RPC chip, and the list is only needed once a row mounts, so
   * `import()` keeps it out of the core chunk.
   *
   * An effect is right here: this is asynchronous loading, not derived state.
   */
  const [alternatives, setAlternatives] = useState<RpcChoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    void import("../../lib/rpcSuggestions").then((m) => {
      if (!cancelled) setAlternatives(m.rpcAlternatives(chainId));
    });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  const apply = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter an http(s) RPC URL.");
      return;
    }
    const saved = setRpcOverride(chainId, trimmed);
    if (!saved) {
      setError("Not a valid http(s) URL.");
      return;
    }
    setError(null);
    setStored(saved);
    setDraft(saved);
    onChange?.(saved);
  };

  const clear = () => {
    clearRpcOverride(chainId);
    setStored(null);
    setDraft("");
    setError(null);
    onChange?.(null);
  };

  return (
    <div className="flex flex-col gap-inline min-w-0">
      {/*
       * The endpoint in force, always shown. An empty field with a grey
       * placeholder reads as "not configured", so the row names the URL the
       * browser calls.
       */}
      <div className="flex flex-wrap items-center gap-x-inline gap-y-tight min-w-0">
        {showName && (
          <span className="text-sm font-medium theme-text">{name}</span>
        )}
        <span
          className={`px-1.5 py-0.5 text-[11px] theme-mono ${
            stored ? "theme-accent-bg theme-accent" : "theme-tertiary-bg theme-text-muted"
          }`}
        >
          {stored ? "your node" : "Valve public node"}
        </span>
        {effective ? (
          <EndpointUrl url={effective} />
        ) : (
          <span className="text-xs theme-text-muted">no endpoint configured</span>
        )}
      </div>

      <OverrideField
        draft={draft}
        onDraft={(value) => {
          setDraft(value);
          if (error) setError(null);
        }}
        onApply={apply}
        onClear={clear}
        canClear={stored !== null}
        error={error}
        placeholder="https://your-node.example/rpc"
      />

      {/*
       * The endpoints the user can switch to, plus the one in force. One
       * Test then covers the node in use and the alternatives.
       * `rpcAlternatives` already leads with Valve's, so this prepends only
       * when the user has set their own.
       */}
      <RpcAlternatives
        choices={
          stored && !alternatives.some((c) => c.url === stored)
            ? [{ url: stored, isValve: false }, ...alternatives]
            : alternatives
        }
        effective={effective}
        onPick={(url) => {
          setDraft(url);
          setError(null);
        }}
      />
    </div>
  );
}
