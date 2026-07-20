import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "@iconify/react";
import { NAV_GROUPS } from "../../lib/navGroups";
import { useWatchRules } from "../../hooks/useWatchRules";
import { isRuleActionable } from "../../lib/watcher/rules";
import { Tooltip } from "../primitives/Tooltip";
import { RpcSourceChip } from "../settings/RpcSourceChip";
import { WorkspaceSyncStatus } from "../wallet/WorkspaceSyncStatus";
import { WalletConnectButton } from "../wallet/WalletConnectButton";

/** The nav item watches live under — the only one that carries a live badge. */
const WATCH_BADGE_ROUTE = "/workspace";

export function Sidebar({
  collapsed,
  asDrawer = false,
  drawerOpen = false,
  onNavigate,
}: {
  collapsed: boolean;
  asDrawer?: boolean;
  drawerOpen?: boolean;
  onNavigate?: () => void;
}) {
  const { rules } = useWatchRules();
  // Active = enabled AND actionable, i.e. rules the engine actually subscribes.
  const activeWatches = rules.filter(
    (r) => r.enabled && isRuleActionable(r),
  ).length;

  // In drawer mode the aside is always full-label (never the icon rail) and is
  // positioned off-canvas, sliding in when open.
  const effectiveCollapsed = asDrawer ? false : collapsed;

  const wrapperClass = asDrawer
    ? `fixed inset-y-0 left-0 z-40 w-72 flex flex-col theme-secondary-bg bs-r outline-none transition-transform duration-150 ${
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      }`
    : "flex flex-col transition-[width] duration-150 shrink-0 theme-secondary-bg bs-r";

  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (asDrawer && drawerOpen) asideRef.current?.focus();
  }, [asDrawer, drawerOpen]);

  return (
    <aside
      ref={asideRef}
      tabIndex={asDrawer ? -1 : undefined}
      className={wrapperClass}
      style={asDrawer ? undefined : { width: collapsed ? 56 : 240 }}
      aria-hidden={asDrawer && !drawerOpen ? true : undefined}
      // A focusable descendant (the NavLinks) inside an `aria-hidden` subtree
      // is an ARIA validity violation — `inert` removes it from the tab order
      // (and from find-in-page/AT) to match. Only the closed drawer; the
      // desktop sidebar is always interactive.
      inert={asDrawer && !drawerOpen}
      {...(asDrawer
        ? { role: "dialog", "aria-modal": true, "aria-label": "Navigation" }
        : {})}
    >
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            {/* Fixed-height header slot: holds the label (expanded) or a
                centered divider (collapsed). Same height either way, so the
                icon rows below land at the same Y and don't jump on toggle. */}
            <div className="h-7 flex items-center px-3">
              {effectiveCollapsed ? (
                <div className="flex-1 h-px theme-border-bg-muted" />
              ) : (
                <div
                  className="flex items-center gap-tight px-1 text-[10px] uppercase tracking-widest font-semibold theme-text-muted"
                >
                  <span>{group.label}</span>
                  <span className="group/info relative inline-flex items-center">
                    <button
                      type="button"
                      aria-label={`${group.label}: ${group.hint}`}
                      className="opacity-50 hover:opacity-100 transition-opacity"
                    >
                      <Icon icon="heroicons:information-circle" className="w-3 h-3" />
                    </button>
                    <span
                      role="tooltip"
                      className="card pointer-events-none absolute top-full left-0 mt-1 z-50 hidden group-hover/info:block w-44 px-2 py-1.5 text-[11px] leading-snug normal-case tracking-normal font-normal theme-card-bg theme-text-secondary"
                    >
                      {group.hint}
                    </span>
                  </span>
                </div>
              )}
            </div>
            {group.items.map((item) => {
              const link = (
              <NavLink
                to={item.to}
                onClick={onNavigate}
                className="relative flex items-center transition-colors overflow-hidden"
                style={({ isActive }) =>
                  effectiveCollapsed
                    ? {
                        width: 40,
                        height: 36,
                        marginLeft: "auto",
                        marginRight: "auto",
                        justifyContent: "center",
                        backgroundColor: isActive
                          ? "var(--color-accent-muted)"
                          : "transparent",
                        color: isActive
                          ? "var(--color-accent)"
                          : "var(--color-text-secondary)",
                        textDecoration: "none",
                      }
                    : {
                        width: "100%",
                        gap: 10,
                        paddingLeft: 16,
                        paddingRight: 16,
                        paddingTop: 8,
                        paddingBottom: 8,
                        backgroundColor: isActive
                          ? "var(--color-accent-muted)"
                          : "transparent",
                        color: isActive
                          ? "var(--color-accent)"
                          : "var(--color-text-secondary)",
                        boxShadow: isActive
                          ? "inset 2px 0 0 0 var(--color-accent)"
                          : "inset 2px 0 0 0 transparent",
                        textDecoration: "none",
                      }
                }
              >
                <Icon icon={item.icon} className="w-5 h-5 shrink-0" />
                {!effectiveCollapsed && (
                  <span className="text-sm whitespace-nowrap flex-1">
                    {item.label}
                  </span>
                )}
                {item.to === WATCH_BADGE_ROUTE &&
                  activeWatches > 0 &&
                  (effectiveCollapsed ? (
                    <Tooltip
                      className="absolute top-1 right-1.5"
                      label={`${activeWatches} active watch${
                        activeWatches === 1 ? "" : "es"
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip
                      className="shrink-0"
                      label={`${activeWatches} active watch${
                        activeWatches === 1 ? "" : "es"
                      }`}
                    >
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 tabular-nums"
                        style={{
                          backgroundColor: "var(--color-accent-muted)",
                          color: "var(--color-accent)",
                        }}
                      >
                        {activeWatches}
                      </span>
                    </Tooltip>
                  ))}
              </NavLink>
              );
              return effectiveCollapsed ? (
                <Tooltip
                  key={item.to}
                  className="w-full justify-center"
                  label={item.label}
                >
                  {link}
                </Tooltip>
              ) : (
                <div key={item.to}>{link}</div>
              );
            })}
          </div>
        ))}
      </nav>

      {asDrawer && (
        <div className="bs-t-muted p-4 flex flex-col gap-row">
          <RpcSourceChip />
          <WorkspaceSyncStatus />
          <WalletConnectButton />
        </div>
      )}

      <div
        className="py-2 flex theme-text-muted bs-t-muted"
        style={{
          flexDirection: effectiveCollapsed ? "column" : "row",
          alignItems: "center",
          paddingLeft: effectiveCollapsed ? 0 : 12,
          paddingRight: effectiveCollapsed ? 0 : 12,
          gap: effectiveCollapsed ? 4 : 8,
          justifyContent: effectiveCollapsed ? "center" : "flex-start",
        }}
      >
        {(() => {
          const settingsLink = (
            <NavLink
              to="/settings"
              onClick={onNavigate}
              className="flex items-center transition-colors"
              style={({ isActive }) =>
                effectiveCollapsed
                  ? {
                      width: 40,
                      height: 40,
                      justifyContent: "center",
                      color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                      textDecoration: "none",
                    }
                  : {
                      flex: 1,
                      gap: 8,
                      paddingLeft: 8,
                      paddingRight: 8,
                      paddingTop: 6,
                      paddingBottom: 6,
                      fontSize: 12,
                      color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                      textDecoration: "none",
                    }
              }
            >
              <Icon icon="heroicons:cog-6-tooth" className="w-5 h-5 shrink-0" />
              {!effectiveCollapsed && <span>Settings</span>}
            </NavLink>
          );
          return effectiveCollapsed ? (
            <Tooltip label="Settings">{settingsLink}</Tooltip>
          ) : (
            settingsLink
          );
        })()}
        {!effectiveCollapsed && (
          <>
            <NavLink
              to="/ui"
              onClick={onNavigate}
              className="text-[10px] uppercase tracking-widest"
              style={({ isActive }) => ({
                color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                textDecoration: "none",
              })}
            >
              UI ✶
            </NavLink>
            <NavLink
              to="/drafts"
              onClick={onNavigate}
              className="text-[10px] uppercase tracking-widest"
              style={({ isActive }) => ({
                color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                textDecoration: "none",
              })}
            >
              Drafts ✶
            </NavLink>
          </>
        )}
        {/* Collapsed: UI gallery + Drafts would otherwise be unreachable (the
            text links above are hidden), so surface them as icon links. */}
        {effectiveCollapsed && (
          <>
            <Tooltip label="UI Gallery">
              <NavLink
                to="/ui"
                aria-label="UI Gallery"
                className="flex items-center justify-center"
                style={({ isActive }) => ({
                  width: 40,
                  height: 36,
                  color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                  textDecoration: "none",
                })}
              >
                <Icon icon="heroicons:swatch" className="w-5 h-5 shrink-0" />
              </NavLink>
            </Tooltip>
            <Tooltip label="Drafts">
              <NavLink
                to="/drafts"
                aria-label="Drafts"
                className="flex items-center justify-center"
                style={({ isActive }) => ({
                  width: 40,
                  height: 36,
                  color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                  textDecoration: "none",
                })}
              >
                <Icon icon="heroicons:pencil-square" className="w-5 h-5 shrink-0" />
              </NavLink>
            </Tooltip>
          </>
        )}
      </div>
    </aside>
  );
}
