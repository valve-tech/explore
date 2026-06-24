import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { BackHistoryControl } from "../RecentMenu";
import { WalletConnectButton } from "../wallet/WalletConnectButton";
import { WorkspaceSyncStatus } from "../wallet/WorkspaceSyncStatus";
import { WorkspaceSyncAutoPush } from "../wallet/WorkspaceSyncAutoPush";
import { RpcSourceChip } from "../settings/RpcSourceChip";
import { ExploreLogo } from "./ExploreLogo";
import { ValveLogo } from "./ValveLogo";
import { Tooltip } from "../primitives/Tooltip";
import type { ApiStatus } from "./types";

/* ------------------------------------------------------------------ */
/* Top bar — one row: controls · brand · ⌘K · status                  */
/* ------------------------------------------------------------------ */

export function TopBar({
  collapsed,
  onToggleCollapse,
  apiStatus,
  onOpenPalette,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  apiStatus: ApiStatus;
  onOpenPalette: () => void;
}) {
  const navigate = useNavigate();
  // Subscribe to location so the back button's disabled state stays fresh.
  useLocation();
  const canGoBack =
    ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  const toggleTitle = collapsed ? "Expand sidebar" : "Collapse sidebar";

  const statusColor =
    apiStatus === "connected"
      ? "var(--color-success)"
      : apiStatus === "disconnected"
        ? "var(--color-danger)"
        : "var(--color-warning)";
  const statusText =
    apiStatus === "connected"
      ? "Connected"
      : apiStatus === "disconnected"
        ? "Disconnected"
        : "Checking…";

  // Square controls (w == bar height) pinned to the far left, independent of
  // the sidebar width animation since the bar spans the full window.
  const control =
    "flex items-center justify-center shrink-0 w-12 h-12 transition-opacity";

  return (
    <div
      className="bs-b flex items-stretch h-12 shrink-0 theme-secondary-bg"
    >
      <Tooltip label={toggleTitle}>
        <button
          onClick={onToggleCollapse}
          aria-label={toggleTitle}
          className={`${control} hover:opacity-80 theme-text-secondary bs-r-muted bg-transparent`}
        >
          <Icon
            icon={collapsed ? "heroicons:bars-3" : "heroicons:chevron-double-left"}
            className="w-5 h-5"
          />
        </button>
      </Tooltip>

      <BackHistoryControl canGoBack={canGoBack} onBack={() => navigate(-1)} />

      <div className="flex items-center gap-inline px-4 shrink-0">
        <ExploreLogo className="w-7 h-7 theme-text" />
        <div className="hidden md:flex items-baseline gap-inline">
          <h1 className="text-sm font-semibold theme-text">Explore</h1>
          <span className="text-xs uppercase tracking-wider font-semibold inline-flex items-center gap-tight theme-text-muted">
            by
            <Tooltip label="Valve City">
              <a
                href="https://valve.city"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Valve City"
                className="inline-flex items-center hover:opacity-70 transition-opacity"
              >
                <ValveLogo className="w-4 h-4" />
              </a>
            </Tooltip>
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center px-3 min-w-0">
        <button
          onClick={onOpenPalette}
          className="w-full max-w-2xl flex items-center gap-inline px-3 h-8 text-sm text-left theme-input-bg theme-text-muted bs"
        >
          <Icon
            icon="heroicons:magnifying-glass"
            className="w-4 h-4 shrink-0 theme-text-muted"
          />
          <span className="flex-1 truncate">
            Paste a tx hash, address, block, or function selector…
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 font-mono shrink-0 theme-tertiary-bg theme-text-secondary"
          >
            ⌘K
          </span>
        </button>
      </div>

      <div className="flex items-center gap-inline px-2 shrink-0">
        <RpcSourceChip />
        <WorkspaceSyncAutoPush />
        <WorkspaceSyncStatus />
        <WalletConnectButton />
      </div>

      <div
        className="flex items-center gap-inline px-4 shrink-0 text-sm theme-text-secondary"
      >
        <span className="w-2 h-2" style={{ backgroundColor: statusColor }} />
        <span className="hidden sm:inline">{statusText}</span>
      </div>
    </div>
  );
}
