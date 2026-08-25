import { useEffect, useState } from "react";
import {
  getRpcOverride,
  setRpcOverride,
  clearRpcOverride,
} from "../../lib/rpcEndpoint";
import { VALVE_PUBLIC_RPC } from "../../lib/rpcDefaults";
import type { RpcChoice } from "../../lib/rpcSuggestions";
import { RpcAlternatives } from "./RpcAlternatives";

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
  onChange,
}: {
  chainId: number;
  name: string;
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
   * The suggestion list arrives by DYNAMIC import, and that is load-bearing.
   * This row renders inside the top bar's RPC chip, so a static import would
   * put `@valve-tech/rpc-collector`'s ~272 KB chainlist dataset in the core
   * chunk via TopBar -> RpcSourceChip -> RpcChainRow — paid on every page
   * load for a list only this row shows. `import()` splits it into its own
   * chunk, fetched when a row actually mounts.
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
    <div className="space-y-stack">
      <div className="flex items-center justify-between gap-row">
        <span className="text-xs uppercase tracking-widest theme-text-muted">
          {name}
        </span>
        <code className="text-xs theme-mono theme-text-muted">
          {stored ? "your node" : "Valve public node"}
        </code>
      </div>

      {/*
       * The effective endpoint, always shown. This field used to sit empty
       * with a greyed placeholder, which read as unconfigured — so nobody
       * could tell what the browser would actually call. It is the default
       * until the user sets their own.
       */}
      <div className="flex flex-wrap items-baseline gap-inline text-xs">
        <span className="theme-text-muted uppercase tracking-wide">
          Currently
        </span>
        <code className="theme-mono theme-text break-all">
          {effective ?? "no endpoint configured"}
        </code>
      </div>
      <div className="flex items-center gap-row">
        <input
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          placeholder="https://your-node.example/rpc"
          className={`w-full min-w-0 px-2 py-1.5 text-sm theme-mono theme-input-bg theme-text ${
            error ? "bs-b-danger" : "bs-in-muted"
          }`}
        />
        <button
          type="button"
          onClick={apply}
          className="px-4 py-2 text-sm font-medium theme-accent-solid text-white hover:opacity-90 shrink-0"
        >
          Set
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={stored === null}
          className={`px-4 py-2 text-sm font-medium shrink-0 ${
            stored === null
              ? "theme-tertiary-bg theme-text-muted cursor-not-allowed"
              : "theme-secondary-bg theme-text hover:opacity-90"
          }`}
        >
          Clear
        </button>
      </div>
      {error && <div className="text-xs theme-danger">{error}</div>}

      {/*
       * Endpoints the user can switch to, plus whatever is in force right
       * now, so one Test covers the node actually being called as well as
       * the alternatives. `rpcAlternatives` already leads with Valve's, so
       * this only prepends when the user has set their own.
       */}
      <RpcAlternatives
        choices={
          stored && !alternatives.some((c) => c.url === stored)
            ? [{ url: stored, tracking: "unknown", isValve: false }, ...alternatives]
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
