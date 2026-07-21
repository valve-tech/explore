import { apiUrl } from "../lib/apiBase";
import { scoped } from "../api/chainScope";
import { useActiveChainId } from "../lib/activeChain";
import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAddress, pad, toHex } from "viem";
import { Tooltip } from "./primitives/Tooltip";
import type {
  StorageEntry,
  StorageLayoutResponse,
} from "./StorageLayoutViewer/types";
import { resolveSlot } from "./StorageLayoutViewer/slots";
import { groupByContract } from "./StorageLayoutViewer/grouping";
import { truncateMiddle } from "../lib/format/hash";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Read one storage slot via the backend Etherscan-shaped dispatcher
 * (`module=proxy&action=eth_getStorageAt`) — the browser makes no raw JSON-RPC
 * call (the open /rpc proxy is gone). Returns the 32-byte hex word, or null.
 */
async function readStorageAt(
  address: string,
  slot: string,
  chainId: number,
): Promise<string | null> {
  try {
    const res = await fetch(
      scoped(
        `${apiUrl("/api")}?module=proxy&action=eth_getStorageAt&address=${address}&position=${slot}&tag=latest`,
        chainId,
      ),
    );
    const body = (await res.json()) as { result?: string };
    return body.result ?? null;
  } catch {
    return null;
  }
}

export default function StorageLayoutViewer() {
  const [searchParams] = useSearchParams();
  const [contractAddress, setContractAddress] = useState(
    () => searchParams.get("address") ?? "",
  );
  const [lookupKey, setLookupKey] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<StorageEntry | null>(null);
  const [computedSlot, setComputedSlot] = useState<string | null>(null);
  const [slotValue, setSlotValue] = useState<string | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);

  // ?address= lets the ⌘K palette deep-link to a pre-filled storage view.
  // Watches changes so a second palette paste also takes effect.
  useEffect(() => {
    const fromUrl = searchParams.get("address");
    if (fromUrl && fromUrl !== contractAddress) setContractAddress(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const validAddress = isAddress(contractAddress);

  const chainId = useActiveChainId();
  const { data, isLoading } = useQuery({
    queryKey: ["storage-layout", chainId, contractAddress.toLowerCase()],
    queryFn: async (): Promise<StorageLayoutResponse> => {
      const res = await fetch(
        scoped(apiUrl(`/api/source/${contractAddress}/storage-layout`), chainId),
      );
      return (await res.json()) as StorageLayoutResponse;
    },
    enabled: validAddress,
  });

  const layout = data?.storageLayout;
  const decompiled = data?.decompiled;

  const grouped = useMemo(
    () => (layout ? groupByContract(layout.storage) : new Map<string, StorageEntry[]>()),
    [layout],
  );

  const handleComputeSlot = (entry: StorageEntry) => {
    setSelectedEntry(entry);
    setComputedSlot(null);
    setSlotValue(null);
    setLookupKey("");

    const typeInfo = layout?.types[entry.type];
    if (!typeInfo || typeInfo.encoding !== "mapping") {
      // Simple variable — slot is directly the slot number
      setComputedSlot(pad(toHex(BigInt(entry.slot)), { size: 32 }));
    }
  };

  const handleLookupMapping = async () => {
    if (!selectedEntry || !lookupKey || !validAddress) return;

    const typeInfo = layout?.types[selectedEntry.type];
    const slot = resolveSlot(selectedEntry, typeInfo, lookupKey);
    if (!slot) return;

    setComputedSlot(slot);

    // Fetch the actual value from the chain
    setLoadingValue(true);
    try {
      setSlotValue(await readStorageAt(contractAddress, slot, chainId));
    } catch {
      setSlotValue(null);
    } finally {
      setLoadingValue(false);
    }
  };

  return (
    <div className="flex flex-col gap-0">
      {/* Address input */}
      <div className="card p-2 sm:p-4">
        <h2 className="text-sm font-semibold mb-2 theme-text">
          Storage Layout Viewer
        </h2>
        <p className="text-xs mb-3 theme-text-secondary">
          Enter a contract address to see its storage layout. Verified
          contracts show solc's typed layout; unverified contracts fall
          through to the heimdall decompiler, which infers slot
          accesses, types, and (best-effort) names from the deployed
          bytecode. Click a row to compute its slot hash and read the
          on-chain value.
        </p>
        <input
          type="text"
          value={contractAddress}
          onChange={(e) => {
            setContractAddress(e.target.value.trim());
            setSelectedEntry(null);
            setComputedSlot(null);
          }}
          placeholder="0x... contract address"
          className="w-full px-3 py-2 text-sm card theme-input-bg theme-text theme-mono"
        />
        {validAddress && isLoading && (
          <p className="text-xs mt-2 theme-text-muted">Compiling to extract storage layout...</p>
        )}
        {validAddress && data && !data.ok && (
          <p className="text-xs mt-2 theme-warning">{data.error}</p>
        )}
      </div>

      {/* Decompiled fall-through banner + table for unverified contracts */}
      {!layout && decompiled && (
        <DecompiledLayoutPanel
          decompiled={decompiled}
          contractAddress={contractAddress}
        />
      )}

      {/* Layout table */}
      {layout && (
        <div className="flex gap-0" style={{ minHeight: "400px" }}>
          {/* Variable list */}
          <div className="card flex-1 overflow-auto">
            <div className="card-divider px-3 py-2 theme-secondary-bg">
              <span className="text-xs font-semibold uppercase tracking-wider theme-text-secondary">
                Storage Variables ({layout.storage.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs theme-mono">
                <thead>
                  <tr className="theme-text-muted">
                    <th className="text-left px-3 py-1.5">Slot</th>
                    <th className="text-left px-3 py-1.5">Variable</th>
                    <th className="text-left px-3 py-1.5">Type</th>
                    <th className="text-left px-3 py-1.5">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([contract, entries]) => (
                    <>
                      {grouped.size > 1 && (
                        <tr key={`header-${contract}`}>
                          <td colSpan={4} className="px-3 py-1 text-xs font-semibold theme-accent theme-secondary-bg">
                            {contract}
                          </td>
                        </tr>
                      )}
                      {entries.map((entry, i) => {
                        const typeInfo = layout.types[entry.type];
                        const isSelected = selectedEntry?.label === entry.label && selectedEntry?.slot === entry.slot;
                        const isMapping = typeInfo?.encoding === "mapping";
                        const isArray = typeInfo?.encoding === "dynamic_array";

                        return (
                          <tr
                            key={`${contract}-${i}`}
                            onClick={() => handleComputeSlot(entry)}
                            className={`cursor-pointer${isSelected ? " theme-accent-bg" : ""}`}
                          >
                            <td className="px-3 py-1.5 theme-text-muted">
                              {entry.slot}
                            </td>
                            <td className="px-3 py-1.5 theme-text">
                              {entry.label}
                              {isMapping && <span className="theme-accent"> [map]</span>}
                              {isArray && <span className="theme-accent"> [arr]</span>}
                            </td>
                            <td className="px-3 py-1.5 theme-text-secondary">
                              {typeInfo?.label ?? entry.type}
                            </td>
                            <td className="px-3 py-1.5 theme-text-muted">
                              {typeInfo?.numberOfBytes ?? "?"}B
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Slot inspector */}
          <div className="card overflow-auto" style={{ width: "380px", flexShrink: 0 }}>
            <div className="card-divider px-3 py-2 theme-secondary-bg">
              <span className="text-xs font-semibold uppercase tracking-wider theme-text-secondary">
                Slot Inspector
              </span>
            </div>
            {!selectedEntry ? (
              <div className="px-3 py-8 text-xs text-center theme-text-muted">
                Click a variable to inspect its storage slot
              </div>
            ) : (
              <div className="p-3 space-y-3">
                <div>
                  <label className="text-xs block mb-1 theme-text-secondary">Variable</label>
                  <div className="text-sm font-semibold theme-text theme-mono">
                    {selectedEntry.label}
                  </div>
                </div>
                <div>
                  <label className="text-xs block mb-1 theme-text-secondary">Type</label>
                  <div className="text-xs theme-text theme-mono">
                    {layout.types[selectedEntry.type]?.label ?? selectedEntry.type}
                  </div>
                </div>
                <div>
                  <label className="text-xs block mb-1 theme-text-secondary">Base Slot</label>
                  <div className="text-xs theme-text theme-mono">
                    {selectedEntry.slot} (offset: {selectedEntry.offset})
                  </div>
                </div>

                {/* Mapping/Array key input */}
                {layout.types[selectedEntry.type]?.encoding === "mapping" && (
                  <div>
                    <label className="text-xs block mb-1 theme-text-secondary">
                      Mapping Key <span className="theme-text-muted">(address or uint)</span>
                    </label>
                    <div className="flex gap-tight">
                      <input
                        type="text"
                        value={lookupKey}
                        onChange={(e) => setLookupKey(e.target.value.trim())}
                        placeholder="0x... or number"
                        className="flex-1 px-2 py-1.5 text-xs card theme-input-bg theme-text theme-mono"
                        onKeyDown={(e) => e.key === "Enter" && handleLookupMapping()}
                      />
                      <button
                        onClick={handleLookupMapping}
                        className="px-3 py-1.5 text-xs font-medium theme-accent-solid text-white"
                      >
                        Read
                      </button>
                    </div>
                    <p className="text-xs mt-1 theme-text-muted">
                      slot = keccak256(abi.encode(key, {selectedEntry.slot}))
                    </p>
                  </div>
                )}

                {layout.types[selectedEntry.type]?.encoding === "dynamic_array" && (
                  <div>
                    <label className="text-xs block mb-1 theme-text-secondary">
                      Array Index
                    </label>
                    <div className="flex gap-tight">
                      <input
                        type="text"
                        value={lookupKey}
                        onChange={(e) => setLookupKey(e.target.value.trim())}
                        placeholder="0"
                        className="flex-1 px-2 py-1.5 text-xs card theme-input-bg theme-text theme-mono"
                        onKeyDown={(e) => e.key === "Enter" && handleLookupMapping()}
                      />
                      <button
                        onClick={handleLookupMapping}
                        className="px-3 py-1.5 text-xs font-medium theme-accent-solid text-white"
                      >
                        Read
                      </button>
                    </div>
                    <p className="text-xs mt-1 theme-text-muted">
                      slot = keccak256({selectedEntry.slot}) + index * elemSize
                    </p>
                  </div>
                )}

                {/* For simple variables, auto-read */}
                {layout.types[selectedEntry.type]?.encoding !== "mapping" &&
                  layout.types[selectedEntry.type]?.encoding !== "dynamic_array" &&
                  !slotValue && !loadingValue && computedSlot && (
                  <button
                    onClick={async () => {
                      setLoadingValue(true);
                      try {
                        setSlotValue(
                          await readStorageAt(contractAddress, computedSlot, chainId),
                        );
                      } finally {
                        setLoadingValue(false);
                      }
                    }}
                    className="w-full py-1.5 text-xs font-medium theme-accent-solid text-white"
                  >
                    Read Current Value
                  </button>
                )}

                {/* Computed slot hash */}
                {computedSlot && (
                  <div>
                    <label className="text-xs block mb-1 theme-text-secondary">Computed Slot</label>
                    <div className="text-xs p-2 break-all theme-primary-bg theme-accent theme-mono">
                      {computedSlot}
                    </div>
                  </div>
                )}

                {/* Value */}
                {loadingValue && (
                  <p className="text-xs theme-text-muted">Reading from chain...</p>
                )}
                {slotValue && (
                  <div>
                    <label className="text-xs block mb-1 theme-text-secondary">Current Value</label>
                    <div className="text-xs p-2 break-all theme-primary-bg theme-success theme-mono">
                      {slotValue}
                    </div>
                    {/* Decoded value */}
                    <div className="text-xs mt-1 theme-text-muted">
                      Decimal: {BigInt(slotValue).toString()}
                    </div>
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

/* ------------------------------------------------------------------ */
/* Decompiled layout panel — heimdall fall-through                    */
/* ------------------------------------------------------------------ */

/**
 * Render the heimdall-decompiled storage view when the contract isn't
 * verified. Includes a banner that flags the panel as inferred (not
 * authoritative — heimdall's analyzer makes a best-effort guess), the
 * slot table with type / access / name columns, and the pseudo-source
 * panel beside it when heimdall produced one.
 */
function DecompiledLayoutPanel({
  decompiled,
  contractAddress,
}: {
  decompiled: import("./StorageLayoutViewer/types").DecompiledLayout;
  contractAddress: string;
}) {
  const chainId = useActiveChainId();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slotValue, setSlotValue] = useState<string | null>(null);
  const [loadingValue, setLoadingValue] = useState(false);

  const handleRead = async (slot: string) => {
    setSelectedSlot(slot);
    setSlotValue(null);
    setLoadingValue(true);
    try {
      setSlotValue(await readStorageAt(contractAddress, slot, chainId));
    } catch {
      setSlotValue(null);
    } finally {
      setLoadingValue(false);
    }
  };

  return (
    <div className="space-y-stack">
      <div className="card p-3 theme-warning-bg">
        <div className="flex items-start gap-row">
          <span className="text-xs font-semibold theme-warning shrink-0">
            INFERRED
          </span>
          <p className="text-xs theme-text-secondary">
            Source code isn't verified. These slots were recovered from
            the deployed bytecode by{" "}
            <a
              href="https://github.com/Jon-Becker/heimdall-rs"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-accent hover:underline"
            >
              heimdall
            </a>
            . Names and types are best-effort guesses; access patterns
            are observed directly from the bytecode (high confidence).
          </p>
        </div>
      </div>

      <div className="flex gap-0" style={{ minHeight: "400px" }}>
        {/* Inferred slot list */}
        <div className="card flex-1 overflow-auto">
          <div className="card-divider px-3 py-2 theme-secondary-bg">
            <span className="text-xs font-semibold uppercase tracking-wider theme-text-secondary">
              Inferred Storage Slots ({decompiled.slots.length})
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs theme-mono">
              <thead>
                <tr className="theme-text-muted">
                  <th className="text-left px-3 py-1.5">Slot</th>
                  <th className="text-left px-3 py-1.5">Name</th>
                  <th className="text-left px-3 py-1.5">Type</th>
                  <th className="text-left px-3 py-1.5">Access</th>
                </tr>
              </thead>
              <tbody>
                {decompiled.slots.map((s) => {
                  const isSelected = selectedSlot === s.slot;
                  // Prefer the registry label when present — known proxy
                  // slots are immediately legible even though the contract
                  // isn't verified.
                  const displayName = s.known?.label ?? s.name;
                  const nameContent = (
                    <>
                      {displayName ?? <span className="theme-text-muted">—</span>}
                      {s.known && (
                        <span className="ml-1 text-[9px] uppercase tracking-wider font-semibold theme-accent">
                          ★ known
                        </span>
                      )}
                    </>
                  );
                  return (
                    <tr
                      key={s.slot}
                      onClick={() => void handleRead(s.slot)}
                      className={`cursor-pointer${isSelected ? " theme-accent-bg" : ""}`}
                    >
                      <td className="px-3 py-1.5 theme-text-muted">
                        {truncateSlot(s.slot)}
                      </td>
                      <td className="px-3 py-1.5 theme-text">
                        {s.known?.hint ? (
                          <Tooltip label={s.known.hint}>{nameContent}</Tooltip>
                        ) : (
                          nameContent
                        )}
                      </td>
                      <td className="px-3 py-1.5 theme-text-secondary">
                        {s.inferredType ?? "unknown"}
                      </td>
                      <td className="px-3 py-1.5 theme-text-muted">
                        {s.access.join(" + ")}
                      </td>
                    </tr>
                  );
                })}
                {decompiled.slots.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center theme-text-muted">
                      No constant slot accesses found in the bytecode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inspector + pseudo-source */}
        <div className="card overflow-auto" style={{ width: "380px", flexShrink: 0 }}>
          <div className="card-divider px-3 py-2 theme-secondary-bg">
            <span className="text-xs font-semibold uppercase tracking-wider theme-text-secondary">
              {selectedSlot ? "Slot Inspector" : "Pseudo-source (heimdall)"}
            </span>
          </div>
          {selectedSlot ? (
            <div className="p-3 space-y-3">
              <div>
                <label className="text-xs block mb-1 theme-text-secondary">Slot</label>
                <div className="text-xs p-2 break-all theme-primary-bg theme-accent theme-mono">
                  {selectedSlot}
                </div>
              </div>
              {loadingValue && (
                <p className="text-xs theme-text-muted">Reading from chain...</p>
              )}
              {slotValue && (
                <div>
                  <label className="text-xs block mb-1 theme-text-secondary">Current Value</label>
                  <div className="text-xs p-2 break-all theme-primary-bg theme-success theme-mono">
                    {slotValue}
                  </div>
                  <div className="text-xs mt-1 theme-text-muted">
                    Decimal: {BigInt(slotValue).toString()}
                  </div>
                </div>
              )}
            </div>
          ) : decompiled.pseudoSource ? (
            <pre className="p-3 text-[11px] whitespace-pre-wrap theme-text theme-mono">
              {decompiled.pseudoSource}
            </pre>
          ) : (
            <div className="px-3 py-8 text-xs text-center theme-text-muted">
              Click a row to inspect the slot, or wait for heimdall to
              produce pseudo-source.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shorten a 0x-prefixed slot hex to head…tail for the table column. */
function truncateSlot(slot: string): string {
  return truncateMiddle(slot, { lead: 8, tail: 4 });
}
