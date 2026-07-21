import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { parseBulkPaste, type ParsedItem } from "../../lib/workspace/bulkParse";
import type { Workspace, WorkspaceItem } from "../../lib/workspace/types";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Bulk-paste panel for a workspace. The user pastes a free-form blob — any mix
 * of addresses, tx hashes, block numbers, comma-separated, comments — and the
 * parser sniffs out every recognized entity. The preview shows what got
 * extracted and how many would actually add (vs. already-present), with a
 * single button to add them all.
 *
 * Per-kind breakdown is shown so a user pasting "100 lines of mixed stuff"
 * can sanity-check before committing.
 */
export function BulkPastePanel({
  workspace,
  onAdd,
  onClose,
}: {
  workspace: Workspace;
  onAdd: (items: ParsedItem[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => parseBulkPaste(text), [text]);
  const { fresh, existing } = useMemo(
    () => partitionAgainstWorkspace(parsed, workspace.items),
    [parsed, workspace.items],
  );

  const counts = useMemo(() => countByKind(fresh), [fresh]);

  return (
    <div className="card p-2 sm:p-4 mb-4 space-y-stack">
      <div className="flex items-center justify-between gap-row">
        <div className="flex items-center gap-inline">
          <Icon icon="heroicons:clipboard-document-list" className="w-4 h-4 theme-accent" />
          <h3 className="text-sm font-semibold theme-text">Bulk paste</h3>
        </div>
        <Tooltip label="Close">
          <button onClick={onClose} className="text-xs px-2 py-1 theme-text-muted">
            <Icon icon="heroicons:x-mark" className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
      <p className="text-xs theme-text-secondary">
        Paste a blob: addresses (0x…40), tx hashes (0x…64), or block numbers (one per line).
        Order doesn&apos;t matter; duplicates and entries already in this workspace are ignored.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={`0xabc...0123\n0xdef...0456\n21840192`}
        className="w-full font-mono text-xs px-2 py-2 theme-primary-bg theme-text"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)", resize: "vertical" }}
      />

      {parsed.length > 0 && (
        <div className="text-xs">
          <div className="theme-text-secondary">
            Detected <span className="theme-text font-medium">{parsed.length}</span>
            {" "}entries; <span className="theme-text font-medium">{fresh.length}</span> new,{" "}
            <span className="theme-text-muted">{existing.length} already here</span>.
          </div>
          {fresh.length > 0 && (
            <div className="flex gap-inline flex-wrap text-[11px]">
              {counts.address > 0 && <Chip kind="address" count={counts.address} />}
              {counts.tx > 0 && <Chip kind="tx" count={counts.tx} />}
              {counts.block > 0 && <Chip kind="block" count={counts.block} />}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-inline">
        <button
          type="button"
          disabled={fresh.length === 0 || submitting}
          onClick={async () => {
            if (fresh.length === 0) return;
            setSubmitting(true);
            try {
              await onAdd(fresh);
              setText("");
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
          className="text-xs px-3 py-1.5"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "#fff",
            opacity: fresh.length === 0 || submitting ? 0.5 : 1,
          }}
        >
          {submitting ? "Adding…" : `Add ${fresh.length || 0} item${fresh.length === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1.5 theme-text-secondary"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function partitionAgainstWorkspace(
  parsed: ParsedItem[],
  items: WorkspaceItem[],
): { fresh: ParsedItem[]; existing: ParsedItem[] } {
  const present = new Set(items.map((i) => `${i.kind}:${i.value}`));
  const fresh: ParsedItem[] = [];
  const existing: ParsedItem[] = [];
  for (const p of parsed) {
    if (present.has(`${p.kind}:${p.value}`)) existing.push(p);
    else fresh.push(p);
  }
  return { fresh, existing };
}

function countByKind(items: ParsedItem[]): Record<"address" | "tx" | "block", number> {
  const c = { address: 0, tx: 0, block: 0 };
  for (const i of items) c[i.kind] += 1;
  return c;
}

const LABELS: Record<"address" | "tx" | "block", { one: string; many: string; icon: string }> = {
  address: { one: "address", many: "addresses", icon: "heroicons:identification" },
  tx: { one: "tx", many: "txs", icon: "heroicons:arrow-right-circle" },
  block: { one: "block", many: "blocks", icon: "heroicons:cube" },
};

function Chip({ kind, count }: { kind: "address" | "tx" | "block"; count: number }) {
  const { one, many, icon } = LABELS[kind];
  return (
    <span
      className="inline-flex items-center gap-tight px-1.5 py-0.5 theme-text-secondary"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
    >
      <Icon icon={icon} className="w-3 h-3" />
      {count} {count === 1 ? one : many}
    </span>
  );
}
