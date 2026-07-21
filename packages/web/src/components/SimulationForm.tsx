import { useState } from "react";
import { isAddress } from "viem";
import { parseAmountToBase } from "../lib/format/tokenAmount";
import StateOverrides from "./StateOverrides";
import AbiInput from "./AbiInput";
import { simulateTransaction } from "../api/simulate";
import { useActiveChainId } from "../lib/activeChain";
import type { SimulationResult, StateOverride } from "../types";

interface SimulationFormProps {
  onResult: (result: SimulationResult | null) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
}

export default function SimulationForm({
  onResult,
  onLoading,
  onError,
}: SimulationFormProps) {
  const chainId = useActiveChainId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [calldata, setCalldata] = useState("");
  const [gasLimit, setGasLimit] = useState("8000000");
  const [blockNumber, setBlockNumber] = useState("");
  const [stateOverrides, setStateOverrides] = useState<StateOverride[]>([]);
  const [abi, setAbi] = useState("");

  const fromValid = !from || isAddress(from);
  const toValid = !to || isAddress(to);

  const canSubmit = from && to && fromValid && toValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onLoading(true);
    onError(null);
    onResult(null);

    try {
      // Convert PLS value to wei exactly (viem parseUnits, not float math).
      let weiValue: string | undefined;
      const weiBigInt = value ? parseAmountToBase(value, 18) : null;
      if (weiBigInt !== null) {
        weiValue = "0x" + weiBigInt.toString(16);
      }

      const result = await simulateTransaction(
        {
          from,
          to,
          value: weiValue,
          data: calldata || undefined,
          gasLimit: gasLimit ? parseInt(gasLimit, 10) : undefined,
          blockNumber: blockNumber || "latest",
          stateOverrides: stateOverrides.length > 0 ? stateOverrides : undefined,
          abi: abi && abi !== "__auto_fetch__" ? abi : abi === "__auto_fetch__" ? "__auto_fetch__" : undefined,
        },
        chainId,
      );

      onResult(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      onLoading(false);
    }
  };

  // Theme-token bits move to className composition; the boxShadow border
  // stays in a small style object because it's not a token utility.
  const inputClass = "theme-mono theme-input-bg theme-text";
  const inputStyle = { boxShadow: "0 0 0 1px var(--color-border-default)" };
  const labelClass = "theme-text-secondary";

  return (
    <form onSubmit={handleSubmit} className="space-y-stack">
      {/* Main fields card */}
      <div
        className="rounded-lg bs p-2 sm:p-4 space-y-stack theme-card-bg"
      >
        <h2
          className="text-sm font-semibold pb-3 bs-b-muted theme-text"
        >
          Transaction Parameters
        </h2>

        {/* From */}
        <div>
          <label className={`flex items-center gap-inline text-xs font-medium mb-1.5 ${labelClass}`}>
            From
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider theme-warning-bg theme-warning"
            >
              Impersonate
            </span>
          </label>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f..."
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{
              ...inputStyle,
              boxShadow: !fromValid ? "0 0 0 1px var(--color-danger)" : inputStyle.boxShadow,
            }}
          />
          {!fromValid && (
            <p className="text-xs mt-1 theme-danger">
              Invalid Ethereum address
            </p>
          )}
        </div>

        {/* To */}
        <div>
          <label className={`text-xs font-medium mb-1.5 block ${labelClass}`}>
            To (Contract Address)
          </label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{
              ...inputStyle,
              boxShadow: !toValid ? "0 0 0 1px var(--color-danger)" : inputStyle.boxShadow,
            }}
          />
          {!toValid && (
            <p className="text-xs mt-1 theme-danger">
              Invalid Ethereum address
            </p>
          )}
        </div>

        {/* Value */}
        <div>
          <label className={`text-xs font-medium mb-1.5 block ${labelClass}`}>
            Value (PLS)
          </label>
          <div className="relative">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.0"
              className={`w-full px-3 py-2 rounded-md text-sm pr-14 ${inputClass}`}
              style={inputStyle}
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium theme-text-muted"
            >
              PLS
            </span>
          </div>
          {(() => {
            const wei = parseAmountToBase(value, 18);
            return wei !== null ? (
              <p className="text-xs mt-1 theme-text-muted">
                = {wei.toLocaleString()} wei
              </p>
            ) : null;
          })()}
        </div>

        {/* Calldata */}
        <div>
          <label className={`text-xs font-medium mb-1.5 block ${labelClass}`}>
            Calldata (hex)
          </label>
          <textarea
            value={calldata}
            onChange={(e) => setCalldata(e.target.value)}
            placeholder="0xa9059cbb000000000000000000000000..."
            rows={3}
            className={`w-full px-3 py-2 rounded-md text-sm resize-y ${inputClass}`}
            style={inputStyle}
          />
        </div>

        {/* Gas Limit & Block Number */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={`text-xs font-medium mb-1.5 block ${labelClass}`}>
              Gas Limit
            </label>
            <input
              type="text"
              value={gasLimit}
              onChange={(e) => setGasLimit(e.target.value)}
              placeholder="8000000"
              className={`w-full px-3 py-2 rounded-md text-sm ${inputClass}`}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={`text-xs font-medium mb-1.5 block ${labelClass}`}>
              Block Number
            </label>
            <input
              type="text"
              value={blockNumber}
              onChange={(e) => setBlockNumber(e.target.value)}
              placeholder="latest"
              className={`w-full px-3 py-2 rounded-md text-sm ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* State Overrides */}
      <StateOverrides overrides={stateOverrides} onChange={setStateOverrides} />

      {/* ABI Input */}
      <AbiInput value={abi} onChange={setAbi} />

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
        style={{
          backgroundColor: canSubmit ? "var(--color-accent)" : "var(--color-border-default)",
          color: canSubmit ? "white" : "var(--color-text-muted)",
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.6,
        }}
      >
        Simulate Transaction
      </button>
    </form>
  );
}
