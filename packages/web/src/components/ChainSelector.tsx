import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import {
  ALL_CHAINS,
  CHAINS,
  chainById,
  chainLogoUrl,
  type ChainSelection,
} from "../lib/chains";
import { Tooltip } from "./primitives/Tooltip";

/**
 * Chain picker — drives the "which chain are we searching / displaying"
 * affordance. Lives on the home-page hero and in the top app bar.
 *
 * "All chains" is the default and means cross-chain search; selecting a
 * specific chain narrows results to that chain. Logo glyphs come from
 * gib.show so chains stay visually identifiable without a custom asset
 * pipeline.
 */
interface ChainSelectorProps {
  value: ChainSelection;
  onChange: (next: ChainSelection) => void;
  /** Variant: "compact" hides text on small screens, "full" always shows it. */
  variant?: "compact" | "full";
}

export function ChainSelector({
  value,
  onChange,
  variant = "compact",
}: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — picker stays inline rather than a modal so
  // the hero hierarchy reads cleanly, but it still needs dismiss.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = value === ALL_CHAINS ? null : chainById(value) ?? null;

  return (
    <div ref={ref} className="relative inline-flex">
      <Tooltip
        label={current ? `Searching ${current.name}` : "Searching all chains"}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-tight px-2.5 h-8 text-xs font-medium theme-tertiary-bg theme-text-secondary"
        >
          {current ? (
            <ChainGlyph chainId={current.id} />
          ) : (
            <Icon
              icon="heroicons:globe-alt"
              className="w-3.5 h-3.5 theme-text-secondary"
            />
          )}
          <span
            className={variant === "compact" ? "hidden sm:inline" : "inline"}
          >
            {current ? current.name : "All chains"}
          </span>
          <Icon
            icon={open ? "heroicons:chevron-up" : "heroicons:chevron-down"}
            className="w-3 h-3 theme-text-muted"
          />
        </button>
      </Tooltip>

      {open && (
        <div
          className="absolute z-20 top-full left-0 mt-1 min-w-[200px] py-1 theme-card-bg bs"
        >
          <ChainRow
            label="All chains"
            sublabel="cross-chain search"
            selected={value === ALL_CHAINS}
            onPick={() => {
              onChange(ALL_CHAINS);
              setOpen(false);
            }}
            icon={
              <Icon
                icon="heroicons:globe-alt"
                className="w-4 h-4 theme-text-secondary"
              />
            }
          />
          <div className="my-1 mx-2 bs-b-muted" />
          {CHAINS.map((c) => (
            <ChainRow
              key={c.id}
              label={c.name}
              sublabel={`chain ${c.id}${c.testnet ? " · testnet" : ""}`}
              selected={value === c.id}
              onPick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              icon={<ChainGlyph chainId={c.id} />}
              dim={c.testnet}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChainRow({
  label,
  sublabel,
  selected,
  onPick,
  icon,
  dim,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onPick: () => void;
  icon: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full flex items-center gap-row px-3 py-1.5 text-left transition-opacity hover:opacity-90"
      style={{
        backgroundColor: selected ? "var(--color-accent-muted)" : "transparent",
        opacity: dim ? 0.7 : 1,
      }}
    >
      <span className="shrink-0 flex items-center justify-center w-5 h-5">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-medium theme-text">{label}</span>
        <span className="block text-[10px] theme-text-muted">
          {sublabel}
        </span>
      </span>
      {selected && (
        <Icon
          icon="heroicons:check"
          className="w-3.5 h-3.5 shrink-0 theme-accent"
        />
      )}
    </button>
  );
}

/**
 * A chain's logo glyph from gib.show. Falls back to a neutral cube
 * icon when the image fails to load — keeps the layout stable for
 * obscure / future chains that gib.show hasn't catalogued yet.
 */
export function ChainGlyph({ chainId }: { chainId: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Icon
        icon="heroicons:cube-transparent"
        className="w-3.5 h-3.5 theme-text-secondary"
      />
    );
  }
  return (
    <img
      src={chainLogoUrl(chainId)}
      alt=""
      width={14}
      height={14}
      onError={() => setFailed(true)}
      className="rounded-full"
      style={{ objectFit: "cover" }}
    />
  );
}
