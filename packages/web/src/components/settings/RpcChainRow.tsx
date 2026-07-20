import { useState } from "react";
import {
  getRpcOverride,
  setRpcOverride,
  clearRpcOverride,
} from "../../lib/rpcEndpoint";

/**
 * One chain's bring-your-own-RPC override editor: shows the current source
 * ("your node" vs "Explore backend") and lets the user set or clear a per-chain
 * endpoint. Used both in the full Settings panel and in the top-bar RPC chip's
 * quick popover, so the two stay in lockstep.
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
          {stored ? "your node" : "Explore backend"}
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
    </div>
  );
}
