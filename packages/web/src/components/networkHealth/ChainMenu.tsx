import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icon } from "@iconify/react";
import { CHAINS, chainById } from "../../lib/chains";
import { useActiveChainId } from "../../lib/activeChain";
import { chainRoutePrefix, stripChainPrefix } from "../../lib/chainScope";
import { ChainGlyph } from "../ChainSelector";

/**
 * Chain menu for the network-health page. Each chain has its own path
 * (`/eip155/<id>/network-health`), and each menu item is a real link to it,
 * so middle-click and "open in new tab" work. It wears the `Dropdown`
 * primitive's look, but `Dropdown` emits buttons, and a button is not a link.
 */
export function ChainMenu() {
  const active = useActiveChainId();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = chainById(active);
  const rest = stripChainPrefix(location.pathname);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Network"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-inline px-2.5 py-1.5 text-xs transition-colors theme-input-bg theme-text-secondary bs-in-muted"
      >
        <ChainGlyph chainId={active} />
        <span className="truncate">{current?.name ?? `chain ${active}`}</span>
        <Icon icon="heroicons:chevron-down" className="w-3 h-3 shrink-0 theme-text-muted" />
      </button>

      {open && (
        <nav aria-label="Network">
          <ul role="menu" className="card absolute z-30 mt-1 min-w-full right-0 theme-card-bg">
            {CHAINS.map((c) => {
              const on = c.id === active;
              return (
                <li key={c.id} role="none">
                  <Link
                    role="menuitem"
                    to={`${chainRoutePrefix(c.id)}${rest}`}
                    aria-current={on ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-inline px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${on ? "theme-accent" : "theme-text"}`}
                  >
                    <Icon
                      icon="heroicons:check"
                      className="w-3 h-3 shrink-0"
                      style={{ opacity: on ? 1 : 0 }}
                    />
                    <ChainGlyph chainId={c.id} />
                    <span>{c.name}</span>
                    <span className="theme-text-muted">{c.id}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
