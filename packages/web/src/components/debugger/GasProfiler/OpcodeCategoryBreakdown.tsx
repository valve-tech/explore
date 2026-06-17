import type { OpcodeCategory } from "../../../api/debugger";
import { Tooltip } from "../../primitives/Tooltip";
import { formatGas, getCategoryColor } from "./colors";

export function OpcodeCategoryBreakdown({
  categories,
}: {
  categories: OpcodeCategory[];
}) {
  const totalGas = categories.reduce((sum, c) => sum + c.gas, 0);

  return (
    <div>
      <div className="h-8 rounded-lg overflow-hidden flex mb-3 theme-primary-bg">
        {categories.map((cat) => {
          const pct = totalGas > 0 ? (cat.gas / totalGas) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <Tooltip
              key={cat.category}
              label={`${cat.category}: ${formatGas(cat.gas)} gas (${pct.toFixed(1)}%)`}
              className="h-full"
            >
              <div
                className="h-full transition-all relative group"
                style={{
                  width: `${pct}%`,
                  backgroundColor: getCategoryColor(cat.category),
                  opacity: 0.75,
                }}
              />
            </Tooltip>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-inline">
        {categories.map((cat) => {
          const color = getCategoryColor(cat.category);
          return (
            <div
              key={cat.category}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
              style={{
                backgroundColor: `${color}20`,
                boxShadow: `0 0 0 1px ${color}40`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium" style={{ color }}>
                {cat.category}
              </span>
              <span className="font-mono theme-text-secondary">
                {cat.percentage.toFixed(1)}%
              </span>
              <span className="font-mono theme-text-muted">
                ({cat.count})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
