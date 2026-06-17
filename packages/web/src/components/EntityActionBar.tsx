/**
 * Discoverable cross-feature action bar for a detail entity (tx / address /
 * contract). Surfaces the same jumps that `TxRowActions` / `AddressRowActions`
 * hide behind a "…" overflow on table rows — but first-class, because a detail
 * header has room to answer "what can I do with this thing?".
 *
 * Two variants:
 *   labeled  — verb-first buttons, the primary jump accented (detail headers)
 *   compact  — icon-only buttons with Tooltips (tight headers, e.g. debugger)
 *
 * Navigation uses the hash router, matching the row-action components.
 */

import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { Tooltip } from "./primitives/Tooltip";
import { CopyButton } from "./primitives/CopyButton";
import { scanPath } from "../lib/scanRoutes";

export type EntityKind = "tx" | "address" | "contract";

interface Action {
  id: string;
  label: string;
  icon: string;
  href: string;
  primary?: boolean;
}

function actionsFor(
  kind: EntityKind,
  value: string,
  contractAddress?: string | null,
): Action[] {
  if (kind === "tx") {
    const list: Action[] = [
      { id: "debug", label: "Debug", icon: "heroicons:bug-ant", href: `/debugger/${value}`, primary: true },
      { id: "fork", label: "Fork from here", icon: "heroicons:arrows-right-left", href: `/fork?fromTx=${value}` },
      { id: "explorer", label: "Open in Explorer", icon: "heroicons:magnifying-glass", href: scanPath("tx", value) },
    ];
    if (contractAddress) {
      list.push({
        id: "storage",
        label: "Storage layout",
        icon: "heroicons:rectangle-stack",
        href: `/storage?address=${contractAddress}`,
      });
    }
    return list;
  }
  // address + contract share the address jump set
  return [
    { id: "explorer", label: "Open in Explorer", icon: "heroicons:magnifying-glass", href: scanPath(kind === "contract" ? "contract" : "address", value), primary: true },
    { id: "simulate", label: "Simulate call", icon: "heroicons:play-circle", href: `/simulate?to=${value}` },
    { id: "storage", label: "Storage layout", icon: "heroicons:rectangle-stack", href: `/storage?address=${value}` },
    { id: "debugger", label: "Debugger", icon: "heroicons:bug-ant", href: `/debugger` },
  ];
}

export function EntityActionBar({
  kind,
  value,
  contractAddress,
  variant = "labeled",
  omit = [],
  className = "",
}: {
  kind: EntityKind;
  value: string;
  contractAddress?: string | null;
  variant?: "labeled" | "compact";
  omit?: string[];
  className?: string;
}) {
  const navigate = useNavigate();
  const actions = actionsFor(kind, value, contractAddress).filter(
    (a) => !omit.includes(a.id),
  );
  // If the natural primary was omitted, promote the first remaining action.
  const hasPrimary = actions.some((a) => a.primary);
  const copyTitle = kind === "tx" ? "Copy tx hash" : "Copy address";

  if (variant === "compact") {
    return (
      <div className={`inline-flex items-center gap-tight ${className}`}>
        {actions.map((a) => (
          <Tooltip key={a.id} label={a.label}>
            <button
              type="button"
              onClick={() => navigate(a.href)}
              aria-label={a.label}
              className="flex items-center justify-center w-7 h-7 transition-colors theme-text-muted"
              style={{
                backgroundColor: "transparent",
                boxShadow: "inset 0 0 0 1px var(--color-border-muted)",
              }}
            >
              <Icon icon={a.icon} className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ))}
        <CopyButton value={value} title={copyTitle} size={28} />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-inline flex-wrap ${className}`}>
      {actions.map((a, i) => {
        const isPrimary = a.primary || (!hasPrimary && i === 0);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => navigate(a.href)}
            className={`inline-flex items-center gap-tight text-xs px-3 py-1.5 transition-colors ${
              isPrimary ? "" : "theme-tertiary-bg theme-text-secondary"
            }`}
            style={
              isPrimary
                ? { backgroundColor: "var(--color-accent)", color: "#fff" }
                : { boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }
            }
          >
            <Icon icon={a.icon} className="w-3.5 h-3.5" />
            {a.label}
          </button>
        );
      })}
      <CopyButton
        value={value}
        title={copyTitle}
        size={30}
        className="bs-muted"
      />
    </div>
  );
}
