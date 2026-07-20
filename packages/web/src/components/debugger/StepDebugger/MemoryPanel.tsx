import { CollapsiblePanel } from "./CollapsiblePanel";
import { memoryToBytes, formatMemoryRow } from "./format";

/** Collapsible hex/ascii view of EVM memory, 16-byte rows. Caps at 1KB display. */
export function MemoryPanel({
  memory,
  loading,
  highlight,
}: {
  memory: string[];
  loading?: boolean;
  /** Byte region the current opcode reads/writes — rows overlapping it tint. */
  highlight?: { kind: "read" | "write"; offset: number; size: number } | null;
}) {
  const memoryHex = memoryToBytes(memory);
  const memorySize = memoryHex.length / 2;
  const memoryRows = Math.min(Math.ceil(memorySize / 16), 64); // Cap at 1KB display

  return (
    <CollapsiblePanel title="Memory" count={memorySize} suffix="bytes" defaultOpen={false}>
      <div className="overflow-y-auto overflow-x-auto px-3 py-1" style={{ maxHeight: "200px" }}>
        {loading ? (
          <div className="py-4 text-xs text-center theme-text-muted">Loading memory…</div>
        ) : memorySize === 0 ? (
          <div className="py-4 text-xs text-center theme-text-muted">Memory is empty</div>
        ) : (
          <>
            {Array.from({ length: memoryRows }, (_, i) => {
              const offset = i * 16;
              const { hex, ascii } = formatMemoryRow(memoryHex, offset);
              // Does this 16-byte row overlap the region the current op touches?
              const touched =
                !!highlight &&
                highlight.size > 0 &&
                offset < highlight.offset + highlight.size &&
                offset + 16 > highlight.offset;
              return (
                <div
                  key={i}
                  className="flex items-center text-xs py-0.5 theme-mono"
                  style={{
                    backgroundColor: touched
                      ? highlight!.kind === "write"
                        ? "rgba(210, 153, 34, 0.12)"
                        : "var(--color-accent-muted)"
                      : undefined,
                    boxShadow: touched
                      ? `inset 2px 0 0 0 ${highlight!.kind === "write" ? "var(--color-warning)" : "var(--color-accent)"}`
                      : undefined,
                  }}
                >
                  <span className="w-12 text-right mr-2 flex-shrink-0 theme-text-muted">
                    {offset.toString(16).padStart(4, "0")}
                  </span>
                  <span className="flex-1 mr-3 theme-text">{hex}</span>
                  <span className="flex-shrink-0 theme-text-muted">{ascii}</span>
                </div>
              );
            })}
            {memorySize > 1024 && (
              <div className="text-xs py-1 text-center theme-text-muted">
                Showing first 1KB of {memorySize.toLocaleString()} bytes
              </div>
            )}
          </>
        )}
      </div>
    </CollapsiblePanel>
  );
}
