/**
 * Presentation helpers for recent/pinned entities, shared by the global
 * back-button history dropdown (RecentMenu) and the Landing rail (RecentRail)
 * so both render rows identically.
 */

import type { RecentEntity } from "./recentEntities";
import { scanPath } from "./scanRoutes";

/** Kind dot colour — tx by status, addresses green, contracts purple. */
export function dotColor(e: RecentEntity): string {
  if (e.kind === "tx") {
    if (e.status === "success") return "var(--color-success)";
    if (e.status === "reverted") return "var(--color-danger)";
    return "var(--color-text-muted)";
  }
  if (e.kind === "address") return "var(--color-success)";
  if (e.kind === "contract") return "var(--color-accent)";
  return "var(--color-text-muted)"; // block
}

/**
 * The chain a recents link should name, or `undefined` for a bare path.
 *
 * An address is valid on every chain, and `/address/0x…` with no prefix is
 * the documented "show me every chain" route. Scoping it would answer a
 * narrower question than the user asked, so an address link stays bare
 * whatever chain the entry was seen on.
 *
 * Every other kind names its chain. A transaction hash lives on exactly one
 * chain. A contract is deployed per chain, and a block number means a
 * different block on each one — sending the user to an all-chain fan-out
 * after they viewed one chain's block is both a worse answer and four times
 * the RPC spend.
 *
 * `undefined` also covers the two cases with no chain to name: an entry
 * written before the store recorded one, and a visit made on an all-chain
 * page. Both fall back to the bare path, which is what shipped before, so
 * `useResolvedChainRedirect` finds the real chain for a hash and the
 * all-chain views render for an address.
 */
export function chainForHref(e: RecentEntity): number | undefined {
  return e.kind === "address" ? undefined : e.chainId;
}

/**
 * Hash-router target for an entity (EIP-3091 path scheme), scoped to the
 * chain the entry was seen on. This is the ONLY place a recents link is
 * built — the ⌘K palette calls it too — so the two surfaces cannot drift.
 */
export function hrefFor(e: RecentEntity): string {
  return scanPath(e.kind, e.value, chainForHref(e));
}

function truncMid(v: string): string {
  if (!v.startsWith("0x") || v.length <= 16) return v;
  return `${v.slice(0, 8)}…${v.slice(-6)}`;
}

export function primaryLabel(e: RecentEntity): string {
  if (e.label) return e.label;
  return e.value.startsWith("0x") ? truncMid(e.value) : `#${e.value}`;
}

export function secondaryLabel(e: RecentEntity): string {
  const parts: string[] = [e.kind];
  if (e.kind === "tx" && e.status) parts.push(e.status);
  if (e.visits > 1) parts.push(`${e.visits} visits`);
  else parts.push(ago(e.lastSeen));
  return parts.join(" · ");
}

function ago(ms: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
