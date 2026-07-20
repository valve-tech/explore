import { isStorageOp } from "@valve-tech/trace-sdk/hooks";
import { Tooltip } from "../../primitives/Tooltip";
import { PanelHeader } from "./PanelHeader";
import { formatWord, truncateWord } from "./format";

export interface StorageDiff {
  slot: string;
  oldValue: string | null;
  newValue: string;
}

/** Shows storage slot writes that happened at the current step
 *  (curr.storage vs. prev.storage). Always visible below the active tab. */
export function StoragePanel({
  diffs,
  currentOp,
  loading,
  highlightSlot,
}: {
  diffs: StorageDiff[];
  currentOp: string;
  loading?: boolean;
  /** Slot the current SLOAD/SSTORE targets — shown even when there's no write. */
  highlightSlot?: string | null;
}) {
  return (
    <div className="card overflow-hidden">
      <PanelHeader title="Storage" count={diffs.length} suffix="changes" />
      <div className="overflow-y-auto" style={{ maxHeight: "200px" }}>
        {loading ? (
          <div className="px-3 py-4 text-xs text-center theme-text-muted">
            Loading storage…
          </div>
        ) : diffs.length === 0 ? (
          <div className="px-3 py-3 text-xs theme-text-muted">
            {highlightSlot ? (
              <span className="flex items-center gap-tight theme-mono">
                <span>{isStorageOp(currentOp) ? "reads slot" : "slot"}</span>
                <Tooltip label={formatWord(highlightSlot)}>
                  <span className="break-all theme-warning">
                    {truncateWord(highlightSlot)}
                  </span>
                </Tooltip>
                <span>(no change)</span>
              </span>
            ) : (
              <span className="block text-center">
                {isStorageOp(currentOp) ? "Storage read (no change)" : "No storage changes at this step"}
              </span>
            )}
          </div>
        ) : (
          <div className="px-3 py-1 space-y-2">
            {diffs.map((d, i) => (
              <div key={i} className="text-xs theme-mono">
                <div className="flex items-center gap-tight">
                  <span className="theme-text-muted">slot:</span>
                  <Tooltip label={formatWord(d.slot)} className="min-w-0">
                    <span className="break-all theme-warning">
                      {truncateWord(d.slot)}
                    </span>
                  </Tooltip>
                </div>
                {d.oldValue !== null && (
                  <div className="flex items-center gap-tight pl-4">
                    <span className="theme-danger">-</span>
                    <Tooltip label={formatWord(d.oldValue)} className="min-w-0">
                      <span className="break-all theme-text-secondary">
                        {truncateWord(d.oldValue)}
                      </span>
                    </Tooltip>
                  </div>
                )}
                <div className="flex items-center gap-tight pl-4">
                  <span className="theme-success">+</span>
                  <Tooltip label={formatWord(d.newValue)} className="min-w-0">
                    <span className="break-all theme-accent">
                      {truncateWord(d.newValue)}
                    </span>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
