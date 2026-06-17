/**
 * A navigable explorer reference (tx hash, address, block) rendered as a real
 * <a href> so the browser's native open-in-new-tab works:
 *   - plain left-click  → preventDefault + in-app SPA navigation (fast, keeps
 *                         the explorer's internal history stack)
 *   - ⌘/ctrl/shift/alt-click, middle-click → fall through to the browser,
 *                         which opens the href in a new tab/window
 *
 * Programmatic navigation (onClick + window.location) can't do this because
 * there's no URL for the browser to target — an anchor with an href can.
 *
 * Generic over the target shape so it works with every table's nav-target
 * type (AddressNavTarget, the panel's target, etc.) without coupling.
 */

import type { ReactNode, CSSProperties } from "react";
import { scanPath, type ScanKind } from "../../lib/scanRoutes";
import { Tooltip } from "../primitives/Tooltip";

interface ExplorerTargetLike {
  type: string; // "tx" | "address" | "block" | "contract"
  value: string;
}

/** Map a nav target to the hash URL (EIP-3091 path scheme). */
function hrefForTarget(target: ExplorerTargetLike): string {
  const kinds = ["tx", "block", "address", "contract"] as const;
  const kind: ScanKind = kinds.includes(target.type as ScanKind)
    ? (target.type as ScanKind)
    : "address";
  return `#${scanPath(kind, target.value)}`;
}

export function ExplorerLink<T extends ExplorerTargetLike>({
  target,
  onNavigate,
  title,
  className,
  style,
  children,
}: {
  target: T;
  onNavigate: (target: T) => void;
  title?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const link = (
    <a
      href={hrefForTarget(target)}
      className={className}
      style={style}
      onClick={(e) => {
        // Let the browser handle new-tab / new-window intents natively.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate(target);
      }}
    >
      {children}
    </a>
  );

  return title ? <Tooltip label={title}>{link}</Tooltip> : link;
}
