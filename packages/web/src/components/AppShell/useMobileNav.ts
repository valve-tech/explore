import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";

/**
 * Owns the mobile drawer's open/closed state. This is deliberately separate
 * from `useSidebarState` (desktop rail collapse): the drawer is ephemeral and
 * resets on navigation, whereas the collapse is persisted and sticky. Merging
 * them into one boolean is what made the sidebar un-responsive to begin with.
 */
export function useMobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  // Close on route change. Depending on pathname keeps this a pure reaction to
  // navigation, not a click-time side effect threaded through every NavLink.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Close on Escape. The backdrop covers tap-to-close; this covers keyboard.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Lock body scroll while the drawer is open so the page behind it can't
  // scroll along with the drawer's own content.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Stable identities: AppShell's mobile->desktop reset effect depends on
  // `closeDrawer`, and a fresh function on every render would re-run that
  // effect on every AppShell render rather than only on the isMobile flip.
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return { drawerOpen, openDrawer, closeDrawer };
}
