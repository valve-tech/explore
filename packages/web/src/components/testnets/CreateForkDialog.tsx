import { useState } from "react";
import { createFork, type ForkInfo } from "../../api/testnets";
import { useActiveChainId } from "../../lib/activeChain";
import { CHAINS } from "../../lib/chains";
import { ChainGlyph } from "../ChainSelector";

interface CreateForkDialogProps {
  onCreated: (fork: ForkInfo) => void;
  onCancel: () => void;
}

export default function CreateForkDialog({
  onCreated,
  onCancel,
}: CreateForkDialogProps) {
  const activeChainId = useActiveChainId();
  const [chainId, setChainId] = useState(activeChainId);
  const [label, setLabel] = useState("");
  const [blockNumber, setBlockNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const fork = await createFork({
        chainId,
        label: label.trim() || undefined,
        blockNumber: blockNumber.trim()
          ? parseInt(blockNumber.trim(), 10)
          : undefined,
      });
      onCreated(fork);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create testnet",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="rounded-lg bs p-2 sm:p-4 w-full max-w-md theme-card-bg"
      >
        <h2
          className="text-lg font-semibold mb-4 theme-text"
        >
          Create Virtual TestNet
        </h2>

        <form onSubmit={handleSubmit} className="space-y-stack">
          {/* Chain */}
          <div>
            <label
              className="block text-sm mb-1 theme-text-secondary"
            >
              Chain to fork
            </label>
            <div className="flex flex-wrap gap-inline">
              {CHAINS.map((c) => {
                const selected = c.id === chainId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChainId(c.id)}
                    className="flex items-center gap-tight px-3 py-1.5 rounded-md bs text-sm theme-text"
                    style={{
                      backgroundColor: selected
                        ? "var(--color-accent-muted)"
                        : "transparent",
                      opacity: c.testnet && !selected ? 0.7 : 1,
                    }}
                    aria-pressed={selected}
                  >
                    <ChainGlyph chainId={c.id} />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Label */}
          <div>
            <label
              className="block text-sm mb-1 theme-text-secondary"
            >
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My TestNet"
              className="w-full px-3 py-2 rounded-md bs text-sm theme-input-bg theme-text"
            />
          </div>

          {/* Block Number */}
          <div>
            <label
              className="block text-sm mb-1 theme-text-secondary"
            >
              Fork Block Number
              <span
                className="ml-1 text-xs theme-text-muted"
              >
                (optional, defaults to latest)
              </span>
            </label>
            <input
              type="number"
              value={blockNumber}
              onChange={(e) => setBlockNumber(e.target.value)}
              placeholder="latest"
              min={0}
              className="w-full px-3 py-2 rounded-md bs text-sm theme-input-bg theme-text"
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="text-sm p-3 rounded-md theme-danger-bg theme-danger"
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-row justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm bs theme-text-secondary"
              style={{ backgroundColor: "transparent" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium text-white"
              style={{
                backgroundColor: loading
                  ? "var(--color-accent-muted)"
                  : "var(--color-accent)",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? (
                <span className="flex items-center gap-inline">
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Creating...
                </span>
              ) : (
                "Create TestNet"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
