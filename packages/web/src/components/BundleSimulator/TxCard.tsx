import { isAddress } from "viem";
import type { BundleTxEntry } from "../../types";

// Theme-token bits compose via className; only the borderless box-shadow
// outline stays as an inline style because there's no utility for it.
const inputClass = "theme-mono theme-input-bg theme-text";
const inputStyle = { boxShadow: "0 0 0 1px var(--color-border-default)" };
const labelClass = "theme-text-secondary";

interface Props {
  tx: BundleTxEntry;
  index: number;
  onChange: (id: string, field: keyof BundleTxEntry, value: string) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

export function TxCard({ tx, index, onChange, onRemove, canRemove }: Props) {
  const fromValid = !tx.from || isAddress(tx.from);
  const toValid = !tx.to || isAddress(tx.to);

  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 space-y-3 theme-card-bg"
    >
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-semibold theme-text"
        >
          <span
            className="inline-flex items-center justify-center w-6 h-6 rounded-full mr-2 text-xs font-bold theme-accent-bg theme-accent"
          >
            {index + 1}
          </span>
          Transaction #{index + 1}
        </h3>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(tx.id)}
            className="text-xs px-2 py-1 rounded hover:opacity-80 theme-danger theme-danger-bg"
          >
            Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-row">
        <div>
          <label
            className={`flex items-center gap-inline text-xs font-medium mb-1 ${labelClass}`}
          >
            From
            <span
              className="px-1 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider theme-warning-bg theme-warning"
            >
              Impersonate
            </span>
          </label>
          <input
            type="text"
            value={tx.from}
            onChange={(e) => onChange(tx.id, "from", e.target.value)}
            placeholder="0x..."
            className="w-full px-2 py-1.5 rounded text-sm"
            style={{
              ...inputStyle,
              boxShadow: !fromValid
                ? "0 0 0 1px var(--color-danger)"
                : inputStyle.boxShadow,
            }}
          />
        </div>
        <div>
          <label className={`text-xs font-medium mb-1 block ${labelClass}`}>
            To
          </label>
          <input
            type="text"
            value={tx.to}
            onChange={(e) => onChange(tx.id, "to", e.target.value)}
            placeholder="0x..."
            className={`w-full px-2 py-1.5 rounded text-sm ${inputClass}`}
            style={{
              boxShadow: !toValid
                ? "0 0 0 1px var(--color-danger)"
                : inputStyle.boxShadow,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-row">
        <div>
          <label className={`text-xs font-medium mb-1 block ${labelClass}`}>
            Value (PLS)
          </label>
          <input
            type="text"
            value={tx.value}
            onChange={(e) => onChange(tx.id, "value", e.target.value)}
            placeholder="0.0"
            className={`w-full px-2 py-1.5 rounded text-sm ${inputClass}`}
            style={inputStyle}
          />
        </div>
        <div>
          <label className={`text-xs font-medium mb-1 block ${labelClass}`}>
            Gas Limit
          </label>
          <input
            type="text"
            value={tx.gasLimit}
            onChange={(e) => onChange(tx.id, "gasLimit", e.target.value)}
            placeholder="8000000"
            className={`w-full px-2 py-1.5 rounded text-sm ${inputClass}`}
            style={inputStyle}
          />
        </div>
        <div className="col-span-1" />
      </div>

      <div>
        <label className={`text-xs font-medium mb-1 block ${labelClass}`}>
          Calldata (hex)
        </label>
        <textarea
          value={tx.data}
          onChange={(e) => onChange(tx.id, "data", e.target.value)}
          placeholder="0x..."
          rows={2}
          className={`w-full px-2 py-1.5 rounded text-sm resize-y ${inputClass}`}
          style={inputStyle}
        />
      </div>
    </div>
  );
}
