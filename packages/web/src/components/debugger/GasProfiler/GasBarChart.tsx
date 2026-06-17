import type { GasEntry } from "../../../api/debugger";
import { Tooltip } from "../../primitives/Tooltip";
import { formatGas, getCallTypeColor } from "./colors";

function flattenForChart(entries: GasEntry[]): GasEntry[] {
  const result: GasEntry[] = [];
  function walk(e: GasEntry) {
    result.push(e);
    for (const c of e.children) walk(c);
  }
  for (const entry of entries) walk(entry);
  result.sort((a, b) => b.totalGas - a.totalGas);
  return result;
}

export function GasBarChart({ entries }: { entries: GasEntry[] }) {
  const items = flattenForChart(entries).slice(0, 20);
  const maxGas = items.length > 0 ? items[0]!.totalGas : 1;

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const pct = maxGas > 0 ? (item.totalGas / maxGas) * 100 : 0;
        const color = getCallTypeColor(item.callType);
        return (
          <div
            key={`${item.address}-${item.function}-${i}`}
            className="flex items-center gap-row"
          >
            <Tooltip label={item.function} className="w-28 flex-shrink-0">
              <div className="w-28 text-xs truncate text-right font-mono theme-text">
                {item.function}
              </div>
            </Tooltip>
            <div className="flex-1 h-6 rounded overflow-hidden relative theme-primary-bg">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: color,
                  opacity: 0.7,
                }}
              />
              <span
                className="absolute inset-y-0 left-2 flex items-center text-xs font-mono font-medium"
                style={{
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                }}
              >
                {formatGas(item.totalGas)}
              </span>
            </div>
            <span className="w-14 text-xs text-right flex-shrink-0 theme-text-secondary">
              {item.percentage.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
