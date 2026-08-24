/**
 * Inline action group rendered next to a transaction hash anywhere in the
 * explorer. Three primary icons + an overflow popover for less common
 * actions. Stops propagation so clicking an action doesn't also trigger
 * the row's default click (which usually navigates to the tx detail).
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { copyToClipboard } from "../../lib/clipboard";
import { scanPath } from "../../lib/scanRoutes";
import { useActiveChainId } from "../../lib/activeChain";
import { Tooltip } from "../primitives/Tooltip";

interface Props {
  /** Transaction hash to act on. */
  hash: string;
  /** Optional contract address the tx interacted with — enables Storage. */
  contractAddress?: string | null;
  /** Compact mode for tight rows: shrinks padding. Default false. */
  compact?: boolean;
}

export default function TxRowActions({
  hash,
  contractAddress,
  compact = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handle = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };

  /**
   * Navigate within the SPA. We can't use <Link> here because the
   * component is reused inside table cells whose clicks would
   * conflict with the link. Use react-router's `navigate()` directly
   * so we stay in the SPA (no full reload, no cache discard).
   */
  const goto = (href: string): void => {
    if (href.startsWith("/")) {
      navigate(href);
    } else {
      window.location.href = href;
    }
  };

  return (
    <div
      className="inline-flex items-center gap-tight"
      onClick={(e) => e.stopPropagation()}
    >
      <ActionIcon
        title="Debug this transaction"
        icon="heroicons:bug-ant"
        compact={compact}
        onClick={(e) => handle(e, () => goto(`/debugger/${hash}`))}
      />
      <ActionIcon
        title="Simulate a fork from this transaction"
        icon="heroicons:arrows-right-left"
        compact={compact}
        onClick={(e) =>
          handle(e, () => goto(`/fork?fromTx=${hash}`))
        }
      />
      <ActionIcon
        title="More actions"
        icon="heroicons:ellipsis-horizontal"
        compact={compact}
        onClick={(e) => handle(e, () => setMenuOpen((v) => !v))}
      />

      {menuOpen && (
        <ActionMenu
          hash={hash}
          contractAddress={contractAddress}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

function ActionIcon({
  title,
  icon,
  compact,
  onClick,
}: {
  title: string;
  icon: string;
  compact: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        aria-label={title}
        className="flex items-center justify-center transition-colors hover:opacity-100"
        style={{
          width: compact ? 22 : 26,
          height: compact ? 22 : 26,
          color: "var(--color-text-muted)",
          backgroundColor: "transparent",
          opacity: 0.7,
        }}
      >
        <Icon icon={icon} className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
      </button>
    </Tooltip>
  );
}

function ActionMenu({
  hash,
  contractAddress,
  onClose,
}: {
  hash: string;
  contractAddress?: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const chainId = useActiveChainId();
  const goto = (href: string): void => {
    if (href.startsWith("/")) {
      navigate(href);
    } else {
      window.location.href = href;
    }
  };

  // Close on outside click + Escape.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items: Array<{
    label: string;
    icon: string;
    onClick: () => void;
    enabled: boolean;
  }> = [
    {
      label: "Copy tx hash",
      icon: "heroicons:clipboard-document",
      enabled: true,
      onClick: () => {
        void copyToClipboard(hash);
        onClose();
      },
    },
    {
      label: "View in Explorer",
      icon: "heroicons:magnifying-glass",
      enabled: true,
      onClick: () => {
        goto(scanPath("tx", hash, chainId));
        onClose();
      },
    },
    {
      label: "View contract storage",
      icon: "heroicons:rectangle-stack",
      enabled: Boolean(contractAddress),
      onClick: () => {
        if (contractAddress) goto(`/storage?address=${contractAddress}`);
        onClose();
      },
    },
  ];

  return (
    <div
      ref={ref}
      className="card absolute z-30 mt-1"
      style={{
        backgroundColor: "var(--color-bg-card)",
        minWidth: 200,
        // Position the menu just below the actions row. The parent has
        // position-static; this absolute anchor places it relative to the
        // nearest positioned ancestor — usually the row's table cell.
        right: 0,
      }}
    >
      <ul>
        {items.map((it) => (
          <li key={it.label}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (it.enabled) it.onClick();
              }}
              disabled={!it.enabled}
              className="w-full flex items-center gap-inline px-3 py-2 text-xs text-left transition-colors"
              style={{
                color: it.enabled
                  ? "var(--color-text-primary)"
                  : "var(--color-text-muted)",
                cursor: it.enabled ? "pointer" : "not-allowed",
                opacity: it.enabled ? 1 : 0.5,
                backgroundColor: "transparent",
              }}
            >
              <Icon icon={it.icon} className="w-3.5 h-3.5 shrink-0" />
              {it.label}
              {!it.enabled && (
                <span
                  className="ml-auto text-[10px] uppercase tracking-wider theme-text-muted"
                >
                  n/a
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

