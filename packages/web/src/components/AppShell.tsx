import { useState, useEffect, type ReactNode } from "react";
import { useSidebarState } from "./AppShell/useSidebarState";
import { useMobileNav } from "./AppShell/useMobileNav";
import { useCommandPaletteShortcut } from "./AppShell/useCommandPaletteShortcut";
import { useIsMobile } from "../hooks/useMediaQuery";
import { TopBar } from "./AppShell/TopBar";
import { Sidebar } from "./AppShell/Sidebar";
import { CommandPalette } from "./AppShell/CommandPalette";
import TestnetToggle from "./settings/TestnetToggle";
import type { ApiStatus } from "./AppShell/types";

export default function AppShell({
  apiStatus,
  children,
}: {
  apiStatus: ApiStatus;
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { collapsed, onToggleCollapse } = useSidebarState();
  const { drawerOpen, openDrawer, closeDrawer } = useMobileNav();
  const isMobile = useIsMobile();

  // Crossing mobile -> desktop (e.g. rotating a tablet, resizing a devtools
  // viewport) while the drawer is open must close it: otherwise `drawerOpen`
  // stays true after the drawer itself stops rendering as a drawer, and
  // `useMobileNav`'s body scroll-lock (keyed on `drawerOpen`) persists until
  // the next navigation. `closeDrawer` is a stable (`useCallback`-wrapped)
  // setter, so this only re-fires on an actual `isMobile` flip, and setting
  // `drawerOpen` to `false` when it's already `false` is a no-op re-render.
  useEffect(() => {
    if (!isMobile) closeDrawer();
  }, [isMobile, closeDrawer]);

  useCommandPaletteShortcut(setPaletteOpen);

  return (
    <div className="h-full flex flex-col min-h-0 theme-primary-bg">
      <TopBar
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onOpenDrawer={openDrawer}
        apiStatus={apiStatus}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="flex-1 flex min-h-0">
        {isMobile ? (
          <>
            {drawerOpen && (
              <button
                aria-label="Close menu"
                onClick={closeDrawer}
                className="fixed inset-0 z-30 bg-black/50"
              />
            )}
            <Sidebar
              collapsed={collapsed}
              asDrawer
              drawerOpen={drawerOpen}
              onNavigate={closeDrawer}
            />
          </>
        ) : (
          <Sidebar collapsed={collapsed} />
        )}
        <div
          data-testid="app-content"
          className="flex-1 overflow-auto min-w-0 p-2 md:p-4"
        >
          {children}
        </div>
      </div>

      <footer className="p-2 sm:p-4 shadow-[0_-1px_0_0_var(--color-border-default)]">
        <TestnetToggle />
      </footer>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
