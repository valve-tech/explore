import { apiUrl } from "../lib/apiBase";
import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { isAddress, encodeFunctionData, type Abi, type AbiFunction } from "viem";
import { useContractSource } from "../hooks/useContractSource";
import type { ForkSimulationResponse } from "../api/simulate";
import {
  getDefaultValue,
  getReadFunctions,
  getWriteFunctions,
  parseArgValue,
} from "./TransactionBuilder/abi";
import { plsToWei } from "./TransactionBuilder/value";

export default function TransactionBuilder() {
  const navigate = useNavigate();
  const [contractAddress, setContractAddress] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [value, setValue] = useState("");
  const [showRead, setShowRead] = useState(false);
  const [result, setResult] = useState<ForkSimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAddress = isAddress(contractAddress);
  const { data: sourceData, isLoading: sourceLoading } = useContractSource(
    validAddress ? contractAddress : null,
  );

  const writeFunctions = useMemo(
    () => (sourceData?.abi ? getWriteFunctions(sourceData.abi as unknown[]) : []),
    [sourceData],
  );
  const readFunctions = useMemo(
    () => (sourceData?.abi ? getReadFunctions(sourceData.abi as unknown[]) : []),
    [sourceData],
  );

  const visibleFunctions = showRead ? readFunctions : writeFunctions;

  const handleSelectFn = useCallback((fn: AbiFunction) => {
    setSelectedFn(fn);
    const defaults: Record<string, string> = {};
    for (const input of fn.inputs ?? []) {
      defaults[input.name ?? ""] = getDefaultValue(input.type);
    }
    setArgs(defaults);
    setResult(null);
    setError(null);
  }, []);

  const handleSimulate = useCallback(async () => {
    if (!selectedFn || !validAddress) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const parsedArgs = (selectedFn.inputs ?? []).map((input) => {
        const raw = args[input.name ?? ""] ?? "";
        return parseArgValue(raw, input.type);
      });

      const calldata = encodeFunctionData({
        abi: [selectedFn] as Abi,
        functionName: selectedFn.name,
        args: parsedArgs,
      });

      const from = fromAddress && isAddress(fromAddress)
        ? fromAddress
        : "0x0000000000000000000000000000000000000001";

      const body: Record<string, unknown> = {
        from,
        to: contractAddress,
        data: calldata,
      };

      const weiHex = plsToWei(value);
      if (weiHex) body.value = weiHex;

      const res = await fetch(apiUrl("/api/simulate/fork"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as ForkSimulationResponse;
      setResult(data);

      if (!data.ok) {
        setError(data.error ?? "Simulation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Encoding failed — check argument types");
    } finally {
      setLoading(false);
    }
  }, [selectedFn, validAddress, args, contractAddress, fromAddress, value]);

  return (
    <div className="flex flex-col gap-0">
      {/* Contract address input */}
      <div className="card p-2 sm:p-4">
        <h2
          className="text-sm font-semibold mb-3 theme-text"
        >
          Transaction Builder
        </h2>

        <div className="flex gap-row mb-3">
          <div className="flex-1">
            <label className="text-xs block mb-1 theme-text-secondary">
              Contract Address
            </label>
            <input
              type="text"
              value={contractAddress}
              onChange={(e) => {
                setContractAddress(e.target.value.trim());
                setSelectedFn(null);
                setResult(null);
              }}
              placeholder="0x..."
              className="w-full px-3 py-2 text-sm card theme-input-bg theme-text theme-mono"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs block mb-1 theme-text-secondary">
              From Address (optional)
            </label>
            <input
              type="text"
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value.trim())}
              placeholder="0x... impersonate any sender"
              className="w-full px-3 py-2 text-sm card theme-input-bg theme-text theme-mono"
            />
          </div>
        </div>

        {validAddress && sourceLoading && (
          <p className="text-xs theme-text-muted">Loading ABI...</p>
        )}
        {validAddress && !sourceLoading && !sourceData && (
          <p className="text-xs theme-warning">
            Contract not verified — ABI not available. Paste raw calldata in Fork Sim instead.
          </p>
        )}
        {validAddress && sourceData && (
          <p className="text-xs theme-success">
            {sourceData.contractName ?? "Contract"} — {writeFunctions.length} write, {readFunctions.length} read functions
          </p>
        )}
      </div>

      {/* Function list + args */}
      {sourceData && sourceData.abi && (
        <div className="flex gap-0" style={{ minHeight: "400px" }}>
          {/* Function list sidebar */}
          <div className="card overflow-hidden flex flex-col" style={{ width: "260px", flexShrink: 0 }}>
            <div className="card-divider flex theme-secondary-bg">
              <button
                onClick={() => setShowRead(false)}
                className={`flex-1 px-3 py-2 text-xs font-medium ${!showRead ? "theme-text theme-card-bg" : "theme-text-muted bg-transparent"}`}
              >
                Write ({writeFunctions.length})
              </button>
              <button
                onClick={() => setShowRead(true)}
                className={`flex-1 px-3 py-2 text-xs font-medium ${showRead ? "theme-text theme-card-bg" : "theme-text-muted bg-transparent"}`}
              >
                Read ({readFunctions.length})
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleFunctions.map((fn, i) => {
                const isSelected = selectedFn?.name === fn.name;
                return (
                  <div
                    key={i}
                    onClick={() => handleSelectFn(fn)}
                    className={`px-3 py-2 text-xs cursor-pointer theme-mono ${isSelected ? "theme-accent theme-accent-bg" : "theme-text bg-transparent"}`}
                    style={{
                      borderLeft: isSelected ? "3px solid var(--color-accent)" : "3px solid transparent",
                    }}
                  >
                    <div className="font-semibold">{fn.name}</div>
                    <div className="theme-text-muted" style={{ fontSize: "10px" }}>
                      ({(fn.inputs ?? []).map((i) => i.type).join(", ")})
                    </div>
                  </div>
                );
              })}
              {visibleFunctions.length === 0 && (
                <div className="px-3 py-4 text-xs text-center theme-text-muted">
                  No {showRead ? "read" : "write"} functions
                </div>
              )}
            </div>
          </div>

          {/* Args + simulate */}
          <div className="card flex-1 p-4 overflow-y-auto">
            {!selectedFn ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm theme-text-muted">
                  Select a function from the list
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3
                    className="text-sm font-semibold theme-text theme-mono"
                  >
                    {selectedFn.name}({(selectedFn.inputs ?? []).map((i) => i.type).join(", ")})
                  </h3>
                  <span
                    className={`text-xs px-2 py-0.5 ${
                      selectedFn.stateMutability === "payable"
                        ? "theme-warning-bg theme-warning"
                        : "theme-accent-bg theme-accent"
                    }`}
                  >
                    {selectedFn.stateMutability}
                  </span>
                </div>

                {/* Argument inputs */}
                {(selectedFn.inputs ?? []).map((input, i) => (
                  <div key={i}>
                    <label className="text-xs block mb-1 theme-text-secondary">
                      <span className="theme-text">{input.name || `arg${i}`}</span>
                      {" "}
                      <span className="theme-mono theme-text-muted">
                        {input.type}
                      </span>
                    </label>
                    <input
                      type="text"
                      value={args[input.name ?? ""] ?? ""}
                      onChange={(e) => setArgs((prev) => ({ ...prev, [input.name ?? ""]: e.target.value }))}
                      placeholder={getDefaultValue(input.type) || input.type}
                      className="w-full px-3 py-2 text-sm card theme-input-bg theme-text theme-mono"
                    />
                  </div>
                ))}

                {/* Value input for payable */}
                {selectedFn.stateMutability === "payable" && (
                  <div>
                    <label className="text-xs block mb-1 theme-warning">
                      Value (PLS)
                    </label>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm card theme-input-bg theme-text theme-mono"
                    />
                  </div>
                )}

                {/* Simulate button */}
                <button
                  onClick={handleSimulate}
                  disabled={loading}
                  className="w-full py-2.5 text-sm font-medium"
                  style={{
                    backgroundColor: loading ? "var(--color-border-default)" : "var(--color-accent)",
                    color: loading ? "var(--color-text-muted)" : "#fff",
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Simulating..." : "Fork Simulate"}
                </button>

                {/* Error */}
                {error && (
                  <div className="p-3 theme-danger-bg theme-danger">
                    <p className="text-xs font-semibold">Error</p>
                    <p className="text-xs mt-1">{error}</p>
                  </div>
                )}

                {/* Result */}
                {result?.ok && result.result && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-inline">
                      <span
                        className={`text-xs px-2 py-0.5 font-semibold ${
                          result.result.success
                            ? "theme-success-bg theme-success"
                            : "theme-danger-bg theme-danger"
                        }`}
                      >
                        {result.result.success ? "SUCCESS" : "REVERTED"}
                      </span>
                      <span className="text-xs theme-text-muted theme-mono">
                        Gas: {Number(result.result.gasUsed).toLocaleString()}
                      </span>
                    </div>

                    {result.result.revertReason && (
                      <pre
                        className="text-xs p-2 whitespace-pre-wrap theme-primary-bg theme-danger theme-mono"
                      >
                        {result.result.revertReason}
                      </pre>
                    )}

                    {/* State changes summary */}
                    {result.result.stateDiff.balanceChanges.length > 0 && (
                      <div className="text-xs theme-text-secondary">
                        {result.result.stateDiff.balanceChanges.length} balance change(s),{" "}
                        {result.result.stateDiff.storageChanges.length} storage change(s)
                      </div>
                    )}

                    {result.result.txHash && (
                      <button
                        onClick={() => navigate(`/debugger/${result.result!.txHash}`)}
                        className="text-xs px-3 py-1.5 font-medium theme-accent-solid text-white"
                      >
                        Debug This Transaction
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
