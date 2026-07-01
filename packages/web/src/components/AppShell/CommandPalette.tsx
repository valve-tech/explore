import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import { useRecentEntities } from "../../hooks/useRecentEntities";
import { resolveEntity } from "../../api/resolve";
import { PaletteWorkspaceDropZone } from "../workspace/PaletteWorkspaceDropZone";
import { parseInput, KIND_LABELS } from "./parseInput";
import {
  buildResults,
  TABS,
  type ResultGroup,
  type PaletteTab,
} from "./buildResults";
import type { Resolution } from "./resolvedJumps";
import { PaletteResultRow } from "./PaletteResultRow";

/* ------------------------------------------------------------------ */
/* Command palette — parse + route                                    */
/* ------------------------------------------------------------------ */

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const recents = useRecentEntities();
  const [value, setValue] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const [selected, setSelected] = useState(0);
  // Tracks whether a result row is being dragged. When true, the palette
  // body is replaced with a workspace-drop overlay; releasing on a workspace
  // tile files the dragged entity. Cleared on dragend (which fires whether
  // or not a drop succeeded), so a release outside any tile just dismisses.
  const [isDragging, setIsDragging] = useState(false);
  const parsed = useMemo(() => parseInput(value), [value]);

  // Cross-chain resolve: a pasted tx/address is located across every registered
  // chain so its jump rows target where it actually exists (not a default). The
  // palette has no chain selector, so this is the only chain signal it has.
  const locatable = parsed.kind === "tx" || parsed.kind === "address";
  const target = locatable ? parsed.value : "";
  const resolveQuery = useQuery({
    queryKey: ["resolve", parsed.kind, target],
    queryFn: () => resolveEntity(target),
    enabled: locatable,
    staleTime: 60_000,
    retry: false,
  });
  const matches = resolveQuery.data?.matches;
  const resolution = useMemo<Resolution>(
    () => ({
      status: !locatable
        ? "idle"
        : resolveQuery.isSuccess
          ? "done"
          : resolveQuery.isLoading
            ? "loading"
            : "idle",
      matches: matches ?? [],
    }),
    [locatable, resolveQuery.isSuccess, resolveQuery.isLoading, matches],
  );

  const results = useMemo(
    () => buildResults(value, parsed, recents, tab, resolution),
    [value, parsed, recents, tab, resolution],
  );

  // Reset the highlight whenever the visible set changes.
  useEffect(() => setSelected(0), [value, tab]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const idx = TABS.findIndex((t) => t.key === tab);
      const next = TABS[(idx + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]!;
      setTab(next.key);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[selected];
      if (r) go(r.to);
    }
  };

  // Render results with a group label whenever the group changes.
  let lastGroup: ResultGroup | null = null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-32 z-50"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <PaletteWorkspaceDropZone
          visible={isDragging}
          onComplete={() => {
            setIsDragging(false);
            onClose();
          }}
        />
        <div className="palette-row relative flex items-center px-4 h-12 bs-b">
          <Icon
            icon="heroicons:magnifying-glass"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none theme-text-muted"
          />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search recent, contracts, pages — or paste a hash / address / block"
            className="bare-input flex-1 h-full pl-7 bg-transparent text-sm outline-none font-mono theme-text"
          />
          {locatable && resolution.status === "loading" && (
            <span className="flex items-center gap-tight text-[10px] px-2 py-1 shrink-0 theme-text-muted">
              <Icon icon="heroicons:arrow-path" className="w-3 h-3 animate-spin" />
              all chains…
            </span>
          )}
          {parsed.kind !== "unknown" && (
            <span
              className="text-[10px] uppercase tracking-widest font-semibold px-2 py-1 shrink-0 theme-accent-bg theme-accent"
            >
              {KIND_LABELS[parsed.kind]}
            </span>
          )}
          <kbd
            className="text-[10px] px-2 py-1 font-mono shrink-0 ml-2 theme-tertiary-bg theme-text-secondary"
          >
            esc
          </kbd>
        </div>

        {/* Scope tabs */}
        <div className="flex items-center gap-tight px-3 pt-2 bs-b-muted">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-[11px] px-3 py-1.5 transition-colors ${on ? "theme-text bs-b-accent-in" : "theme-text-muted"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {locatable &&
          resolution.status === "done" &&
          resolution.matches.length === 0 && (
            <div className="px-4 pt-2 text-[11px] theme-warning">
              Not found on any registered chain — the actions below open the
              default chain.
            </div>
          )}

        {/* Results */}
        {results.length > 0 ? (
          <div className="py-2 max-h-[50vh] overflow-y-auto">
            {results.map((r, i) => {
              const isSel = i === selected;
              const showGroup = r.group !== lastGroup;
              lastGroup = r.group;
              return (
                <div key={r.id}>
                  {showGroup && (
                    <div
                      className="text-[9px] uppercase tracking-widest px-4 pt-2 pb-1 theme-text-muted"
                    >
                      {r.group}
                    </div>
                  )}
                  <PaletteResultRow
                    result={r}
                    selected={isSel}
                    onHover={() => setSelected(i)}
                    onActivate={() => go(r.to)}
                    onDragStart={() => setIsDragging(true)}
                    onDragEnd={() => setIsDragging(false)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-4 text-xs theme-text-muted">
            {value.trim() === ""
              ? "Nothing viewed yet — paste a tx hash, address, block number, or 4byte selector, or jump to a page from the Pages tab."
              : "No matches. Paste a full tx hash, address, block number, or 4byte selector to open it directly."}
          </div>
        )}

        <div className="flex items-center gap-row px-4 py-2 text-[10px] theme-text-muted bs-t-muted">
          <span>
            <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono">tab</kbd> switch scope
          </span>
        </div>
      </div>
    </div>
  );
}
