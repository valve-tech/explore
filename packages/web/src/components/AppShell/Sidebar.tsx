import { NavLink } from "react-router-dom";
import { Icon } from "@iconify/react";
import { NAV_GROUPS } from "../../lib/navGroups";
import { useWatchRules } from "../../hooks/useWatchRules";
import { isRuleActionable } from "../../lib/watcher/rules";
import { Tooltip } from "../primitives/Tooltip";

/** The nav item watches live under — the only one that carries a live badge. */
const WATCH_BADGE_ROUTE = "/workspace";

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { rules } = useWatchRules();
  // Active = enabled AND actionable, i.e. rules the engine actually subscribes.
  const activeWatches = rules.filter(
    (r) => r.enabled && isRuleActionable(r),
  ).length;

  return (
    <aside
      className="flex flex-col transition-[width] duration-150 shrink-0 theme-secondary-bg bs-r"
      style={{
        width: collapsed ? 56 : 240,
      }}
    >
      <nav className="flex-1 overflow-y-auto py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            {/* Fixed-height header slot: holds the label (expanded) or a
                centered divider (collapsed). Same height either way, so the
                icon rows below land at the same Y and don't jump on toggle. */}
            <div className="h-7 flex items-center px-3">
              {collapsed ? (
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
                className="relative flex items-center transition-colors overflow-hidden"
                style={({ isActive }) =>
                  collapsed
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
                {!collapsed && (
                  <span className="text-sm whitespace-nowrap flex-1">
                    {item.label}
                  </span>
                )}
                {item.to === WATCH_BADGE_ROUTE &&
                  activeWatches > 0 &&
                  (collapsed ? (
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
              return collapsed ? (
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

      <div
        className="py-2 flex theme-text-muted bs-t-muted"
        style={{
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          paddingLeft: collapsed ? 0 : 12,
          paddingRight: collapsed ? 0 : 12,
          gap: collapsed ? 4 : 8,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        {(() => {
          const settingsLink = (
            <NavLink
              to="/settings"
              className="flex items-center transition-colors"
              style={({ isActive }) =>
                collapsed
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
              {!collapsed && <span>Settings</span>}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip label="Settings">{settingsLink}</Tooltip>
          ) : (
            settingsLink
          );
        })()}
        {!collapsed && (
          <>
            <NavLink
              to="/ui"
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
        {collapsed && (
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
