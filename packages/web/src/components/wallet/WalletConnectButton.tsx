import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Topbar wallet button.
 *
 * Three states it can render:
 *   1. No injected provider available → disabled prompt to install.
 *   2. Provider available but not connected → "Connect wallet" button.
 *   3. Connected → truncated address chip with a click-to-disconnect popover.
 *
 * Single connector for v0 (the `injected` connector configured in
 * `lib/wagmi.ts`). The connector array has one entry so the picker UX is
 * deferred until WalletConnect / Coinbase Wallet land.
 */
export function WalletConnectButton() {
  const account = useAccount();
  const { connectors, connectAsync, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const [popoverOpen, setPopoverOpen] = useState(false);

  // We only configured the injected() connector, so there's exactly one.
  // If/when more connectors land, swap this for a picker.
  const injected = connectors[0];

  const handleConnect = async () => {
    if (!injected) return;
    reset(); // clear any prior error before a fresh attempt
    await connectAsync({ connector: injected }).catch(() => {
      // Error surfaces via `useConnect().error`; swallow the rejection
      // here so it doesn't propagate as an unhandled promise.
    });
  };

  // Rejecting the wallet prompt is a normal user choice, not an error worth
  // surfacing. wagmi keeps the last error in state until `reset()`, so without
  // this it would sit on screen forever ("User rejected the request…").
  const isUserRejection =
    error != null &&
    (error.name === "UserRejectedRequestError" ||
      /user rejected/i.test(error.message));
  const showError = error != null && !isUserRejection;

  // Never let an error stick permanently: drop a rejection immediately and
  // auto-dismiss a real error after a few seconds (also clears on next attempt).
  useEffect(() => {
    if (error == null) return;
    const timer = setTimeout(() => reset(), isUserRejection ? 0 : 6_000);
    return () => clearTimeout(timer);
  }, [error, isUserRejection, reset]);

  if (!account.isConnected) {
    // No injected provider in the page at all — render a static prompt.
    // The connector is always present in wagmi's state; what changes is
    // whether `window.ethereum` is defined. We can't safely call the
    // connector to introspect that without triggering its UI, so we just
    // attempt the connect on click and let the error surface in the
    // popover if no provider is found.
    return (
      <div className="relative">
        <Tooltip label="Connect a wallet to enable Workspace sync">
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={isPending || !injected}
            className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-tertiary-bg theme-text-secondary"
            style={{
              boxShadow: "inset 0 0 0 1px var(--color-border-muted)",
              opacity: isPending || !injected ? 0.5 : 1,
            }}
          >
            <Icon icon="heroicons:wallet" className="w-3.5 h-3.5" />
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        </Tooltip>
        {showError && (
          <div
            className="absolute right-0 mt-1 p-2 text-[11px] theme-danger-bg theme-danger w-64"
            style={{ boxShadow: "inset 0 0 0 1px var(--color-danger)" }}
          >
            {error.message.includes("No injected") ||
            error.message.includes("not found") ||
            error.message.includes("getProvider")
              ? "No wallet detected. Install MetaMask, Rabby, or another EIP-1193 wallet."
              : error.message}
          </div>
        )}
      </div>
    );
  }

  const addressShort = account.address
    ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}`
    : "";

  return (
    <div className="relative">
      <Tooltip label="Wallet — click for full address">
        <button
          type="button"
          onClick={() => setPopoverOpen((v) => !v)}
          className="text-xs px-3 py-1.5 inline-flex items-center gap-tight font-mono theme-tertiary-bg theme-text"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        >
          <Icon icon="heroicons:wallet" className="w-3.5 h-3.5 theme-accent" />
          {addressShort}
        </button>
      </Tooltip>
      {popoverOpen && (
        <div
          className="absolute right-0 z-50 mt-1 w-64 card p-2 space-y-tight"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
          onMouseLeave={() => setPopoverOpen(false)}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-widest theme-text-muted">
            Connected
          </div>
          <div className="px-2 pb-2 font-mono text-[11px] break-all theme-text">
            {account.address}
          </div>
          <button
            type="button"
            onClick={() => {
              disconnect();
              setPopoverOpen(false);
            }}
            className="w-full text-left px-2 py-1.5 text-xs theme-text-secondary"
            style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
