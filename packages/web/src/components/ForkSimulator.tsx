import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isAddress } from "viem";
import { parseAmountToBase } from "../lib/format/tokenAmount";
import type {
  ForkSimulationResult,
  ForkSimulationResponse,
} from "../api/simulate";
import { forkSimulateApi, simulateFromHashApi } from "./ForkSimulator/api";
import { useActiveChainId } from "../lib/activeChain";
import { scanPath } from "../lib/scanRoutes";
import { InputCard, type InputMode } from "./ForkSimulator/InputCard";
import { StatusSummary } from "./ForkSimulator/StatusSummary";
import {
  BalanceChangesTable,
  StorageChangesTable,
  EventsList,
} from "./ForkSimulator/DiffTables";
import {
  LoadingPanel,
  ErrorPanel,
  RevertReasonBlock,
  NoStateChangesPanel,
  StateDiffUnavailablePanel,
} from "./ForkSimulator/Panels";

function plsToWeiHex(plsValue: string): string | undefined {
  const wei = parseAmountToBase(plsValue, 18); // exact, no float
  return wei === null ? undefined : "0x" + wei.toString(16);
}

export default function ForkSimulator() {
  const navigate = useNavigate();
  const chainId = useActiveChainId();
  const [mode, setMode] = useState<InputMode>("hash");

  /*
   * `?fromTx=<hash>` seeds the hash field. Three call sites have been writing
   * this param for a long time — EntityActionBar's "Fork from here", the tx
   * row action menu, and the tx page's next-steps rail — and nothing read it,
   * so every one of them landed the reader on an empty form with the hash
   * they had just clicked sitting unused in the URL.
   *
   * Seeded once as the initial state rather than synced in an effect: after
   * the first render this field belongs to whoever is typing in it, and a
   * later param change must not overwrite their edit.
   */
  const [searchParams] = useSearchParams();
  const [txHash, setTxHash] = useState(() => {
    const seed = searchParams.get("fromTx") ?? "";
    return /^0x[0-9a-fA-F]{64}$/.test(seed) ? seed : "";
  });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [data, setData] = useState("");
  const [blockNumber, setBlockNumber] = useState("");

  const [result, setResult] = useState<ForkSimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidHash = /^0x[0-9a-fA-F]{64}$/.test(txHash);

  const handleSimulate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response: ForkSimulationResponse =
        mode === "hash"
          ? await simulateFromHashApi(txHash, chainId)
          : await forkSimulateApi(
              {
                from,
                to,
                value: plsToWeiHex(value),
                data: data || undefined,
                blockNumber: blockNumber ? parseInt(blockNumber, 10) : undefined,
              },
              chainId,
            );

      if (!response.ok) {
        setError(response.error ?? "Simulation failed");
        return;
      }
      setResult(response.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [mode, txHash, from, to, value, data, blockNumber, chainId]);

  const canSubmit =
    mode === "hash"
      ? isValidHash && !loading
      : isAddress(from) && isAddress(to) && !loading;

  // An absent flag is an older response from before it existed — treat it as
  // available so a cached result never paints a phantom failure.
  const stateDiffUnavailable = result?.stateDiffAvailable === false;

  const hasNoStateChanges =
    result &&
    !stateDiffUnavailable &&
    result.stateDiff.balanceChanges.length === 0 &&
    result.stateDiff.storageChanges.length === 0 &&
    result.logs.length === 0;

  return (
    <div className="space-y-section">
      <InputCard
        mode={mode}
        setMode={setMode}
        txHash={txHash}
        setTxHash={setTxHash}
        manual={{
          from,
          setFrom,
          to,
          setTo,
          value,
          setValue,
          data,
          setData,
          blockNumber,
          setBlockNumber,
        }}
        canSubmit={canSubmit}
        loading={loading}
        onSimulate={handleSimulate}
      />

      {loading && <LoadingPanel />}
      {!loading && error && <ErrorPanel message={error} />}

      {!loading && result && (
        <div className="space-y-stack">
          <StatusSummary
            result={result}
            onViewContract={(address) => navigate(scanPath("contract", address))}
            onDebug={(hash) => navigate(`/debugger/${hash}`)}
          />

          {result.revertReason && <RevertReasonBlock reason={result.revertReason} />}

          {result.stateDiff.balanceChanges.length > 0 && (
            <BalanceChangesTable changes={result.stateDiff.balanceChanges} />
          )}
          {result.stateDiff.storageChanges.length > 0 && (
            <StorageChangesTable changes={result.stateDiff.storageChanges} />
          )}
          {result.logs.length > 0 && <EventsList logs={result.logs} />}

          {hasNoStateChanges && <NoStateChangesPanel />}
          {stateDiffUnavailable && <StateDiffUnavailablePanel />}
        </div>
      )}
    </div>
  );
}

