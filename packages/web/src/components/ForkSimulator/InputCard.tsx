import { FormField, ModeButton } from "./primitives";

export type InputMode = "hash" | "manual";

export interface ManualInputs {
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  value: string;
  setValue: (v: string) => void;
  data: string;
  setData: (v: string) => void;
  blockNumber: string;
  setBlockNumber: (v: string) => void;
}

interface Props {
  mode: InputMode;
  setMode: (m: InputMode) => void;
  txHash: string;
  setTxHash: (v: string) => void;
  manual: ManualInputs;
  canSubmit: boolean;
  loading: boolean;
  onSimulate: () => void;
}

export function InputCard({
  mode,
  setMode,
  txHash,
  setTxHash,
  manual,
  canSubmit,
  loading,
  onSimulate,
}: Props) {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
    >
      <h2
        className="text-lg font-semibold mb-1 theme-text"
      >
        Fork Simulation
      </h2>
      <p
        className="text-sm mb-4 theme-text-secondary"
      >
        Re-execute a transaction on a forked chain to see exact state changes.
      </p>

      <div className="flex gap-inline mb-4">
        <ModeButton
          active={mode === "hash"}
          onClick={() => setMode("hash")}
          label="Tx Hash"
        />
        <ModeButton
          active={mode === "manual"}
          onClick={() => setMode("manual")}
          label="Manual Entry"
        />
      </div>

      {mode === "hash" ? (
        <div className="space-y-3">
          <input
            type="text"
            placeholder="0x... transaction hash"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value.trim())}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && onSimulate()}
            className="w-full px-4 py-2.5 rounded-lg bs text-sm theme-input-bg theme-text theme-mono"
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-row">
            <FormField
              label="From"
              value={manual.from}
              onChange={manual.setFrom}
              placeholder="0x... sender address"
              mono
            />
            <FormField
              label="To"
              value={manual.to}
              onChange={manual.setTo}
              placeholder="0x... target address"
              mono
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-row">
            <FormField
              label="Value (PLS)"
              value={manual.value}
              onChange={manual.setValue}
              placeholder="0"
            />
            <FormField
              label="Block Number"
              value={manual.blockNumber}
              onChange={manual.setBlockNumber}
              placeholder="latest"
            />
          </div>
          <FormField
            label="Calldata"
            value={manual.data}
            onChange={manual.setData}
            placeholder="0x..."
            mono
            multiline
          />
        </div>
      )}

      <button
        onClick={onSimulate}
        disabled={!canSubmit}
        className="mt-4 w-full px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
        style={{
          backgroundColor: canSubmit
            ? "var(--color-accent)"
            : "var(--color-border-default)",
          color: canSubmit ? "#ffffff" : "var(--color-text-muted)",
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {loading ? "Forking & Simulating..." : "Fork Simulate"}
      </button>
    </div>
  );
}
