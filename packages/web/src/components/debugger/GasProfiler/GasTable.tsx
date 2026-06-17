import type { FlatGasEntry } from "../../../api/debugger";
import { Tooltip } from "../../primitives/Tooltip";
import { formatGas, getCallTypeColor, truncateAddress } from "./colors";

const HEADERS: Array<{ label: string; align: "left" | "right" }> = [
  { label: "Depth", align: "left" },
  { label: "Function", align: "left" },
  { label: "Address", align: "left" },
  { label: "Type", align: "left" },
  { label: "Gas Used", align: "right" },
  { label: "%", align: "right" },
];

export function GasTable({ flat }: { flat: FlatGasEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bs-b">
            {HEADERS.map((h) => (
              <th
                key={h.label}
                className={`py-2 px-3 font-medium theme-text-secondary text-${h.align}`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flat.map((entry, i) => (
            <tr key={i} className="bs-b-muted">
              <td className="py-2 px-3 font-mono theme-text-muted">
                {entry.depth}
              </td>
              <td
                className="py-2 px-3 font-mono theme-text"
                style={{ paddingLeft: `${entry.depth * 12 + 12}px` }}
              >
                {entry.function}
              </td>
              <td className="py-2 px-3 font-mono theme-accent">
                <Tooltip label={entry.address}>
                  {truncateAddress(entry.address)}
                </Tooltip>
              </td>
              <td className="py-2 px-3">
                <span
                  className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: `${getCallTypeColor(entry.callType)}20`,
                    color: getCallTypeColor(entry.callType),
                  }}
                >
                  {entry.callType}
                </span>
              </td>
              <td className="py-2 px-3 text-right font-mono theme-text">
                {formatGas(entry.gasUsed)}
              </td>
              <td className="py-2 px-3 text-right font-mono theme-text-secondary">
                {entry.percentage.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
