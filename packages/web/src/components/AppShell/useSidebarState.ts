import { useState, useEffect } from "react";

const SIDEBAR_COLLAPSED_KEY = "valvetech-shell-sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export interface SidebarState {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Owns the sidebar collapse state: a single global, persisted boolean. The
 * expanded/collapsed state is identical on every route — toggling it anywhere
 * sticks everywhere. (There is deliberately no per-route auto-collapse: that
 * made the sidebar appear to "remember" a state per tab, which it shouldn't.)
 * Mobile uses a separate ephemeral drawer (useMobileNav); this collapse is
 * desktop-only.
 */
export function useSidebarState(): SidebarState {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return { collapsed, onToggleCollapse: () => setCollapsed((c) => !c) };
}
