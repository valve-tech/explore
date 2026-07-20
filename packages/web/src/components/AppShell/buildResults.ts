import type { RecentEntity } from "../../lib/recentEntities";
import { NAV_GROUPS, UTILITY_PAGES } from "../../lib/navGroups";
import { scanPath } from "../../lib/scanRoutes";
import type { WorkspaceItemKind } from "../../lib/workspace/types";
import type { Parsed } from "./parseInput";
import { resolvedActions, type Resolution } from "./resolvedJumps";
import { truncateMiddle } from "../../lib/format/hash";

/* ------------------------------------------------------------------ */
/* Palette result model                                               */
/* ------------------------------------------------------------------ */

export type ResultGroup = "Jump to" | "Recent" | "Contracts" | "Pages";
export type PaletteTab = "all" | "recent" | "contracts" | "pages";

export const TABS: { key: PaletteTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "recent", label: "Recent" },
  { key: "contracts", label: "Contracts" },
  { key: "pages", label: "Pages" },
];

export interface Result {
  id: string;
  group: ResultGroup;
  tag: string;
  label: string;
  detail: string;
  icon: string;
  to: string;
  /** Present when the result represents an entity that can be filed into a
   *  workspace (tx/address/block — not pages or selectors). When set, the
   *  row becomes draggable + shows a + workspace-picker button. */
  entity?: { kind: WorkspaceItemKind; value: string };
}

/** Flattened navigable pages: the sidebar groups plus the footer utility pages
 *  (Settings / UI / Drafts), so ⌘K can jump to them too. */
const PAGES: { label: string; to: string; icon: string }[] = [
  ...NAV_GROUPS.flatMap((g) =>
    g.items.map((it) => ({ label: it.label, to: it.to, icon: it.icon })),
  ),
  ...UTILITY_PAGES.map((it) => ({ label: it.label, to: it.to, icon: it.icon })),
];

function truncMid(v: string): string {
  // Guard preserved (rather than routing straight through `shortHash`) so
  // non-0x values (e.g. block numbers) and the 16-char threshold stay
  // byte-identical to the pre-consolidation behavior these results relied on.
  if (!v.startsWith("0x") || v.length <= 16) return v;
  return truncateMiddle(v, { lead: 8, tail: 6 });
}

function recentToResult(e: RecentEntity): Result {
  const to = scanPath(e.kind, e.value);
  // "contract" recents are addresses with verified bytecode — file as
  // kind:"address" in a workspace (workspaces don't distinguish contracts).
  const wsKind: WorkspaceItemKind =
    e.kind === "contract" ? "address" : e.kind;
  return {
    id: `${e.kind}:${e.value}`,
    group: e.kind === "contract" ? "Contracts" : "Recent",
    tag: e.kind,
    label: e.label ?? (e.value.startsWith("0x") ? truncMid(e.value) : `#${e.value}`),
    detail: e.label ? truncMid(e.value) : e.kind === "tx" && e.status ? e.status : e.kind,
    icon:
      e.kind === "tx"
        ? "heroicons:bug-ant"
        : e.kind === "block"
          ? "heroicons:cube"
          : e.kind === "contract"
            ? "heroicons:document-text"
            : "heroicons:identification",
    to,
    entity: { kind: wsKind, value: e.value },
  };
}

function matches(q: string, ...fields: (string | undefined)[]): boolean {
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** Build the visible, ordered result list for the current query + tab. */
export function buildResults(
  value: string,
  parsed: Parsed,
  recents: RecentEntity[],
  tab: PaletteTab,
  resolution?: Resolution,
): Result[] {
  const q = value.trim().toLowerCase();

  // Only tx/address/block "Jump to" entities can be filed into a workspace;
  // "selector" / "unknown" are excluded by the type guard below.
  const jumpEntity =
    parsed.kind === "tx" || parsed.kind === "address" || parsed.kind === "block"
      ? { kind: parsed.kind, value: parsed.value }
      : undefined;
  // Cross-chain: for a tx/address, jump actions target the chain(s) the entity
  // actually exists on (resolved via /api/resolve); falls back to the parser's
  // default-chain actions while resolving or when found nowhere.
  const jump: Result[] =
    parsed.kind === "unknown"
      ? []
      : resolvedActions(parsed, resolution).map((a) => ({
          id: a.to,
          group: "Jump to" as const,
          tag: parsed.kind,
          label: a.label,
          detail: a.detail,
          icon: a.icon,
          to: a.to,
          entity: jumpEntity,
        }));

  const recentResults = recents
    .filter((e) => matches(q, e.label, e.value))
    .map(recentToResult);
  const contracts = recentResults.filter((r) => r.group === "Contracts");
  const recentOnly = recentResults.filter((r) => r.group === "Recent");

  const pages: Result[] = PAGES.filter((p) => matches(q, p.label, p.to)).map(
    (p) => ({
      id: `page:${p.to}`,
      group: "Pages",
      tag: "page",
      label: p.label,
      detail: p.to,
      icon: p.icon,
      to: p.to,
    }),
  );

  switch (tab) {
    case "recent":
      return [...recentOnly, ...contracts];
    case "contracts":
      return contracts;
    case "pages":
      return pages;
    case "all":
      // Empty query → lead with what the user has touched, hide page noise.
      if (q === "") return [...recentOnly, ...contracts];
      return [...jump, ...contracts, ...recentOnly, ...pages];
  }
}
