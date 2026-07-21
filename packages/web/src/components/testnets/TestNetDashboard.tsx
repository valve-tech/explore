import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { listForks, getFork, type ForkInfo } from "../../api/testnets";
import CreateForkDialog from "./CreateForkDialog";
import ForkControls from "./ForkControls";
import { ForkChainBadge } from "./ForkChainBadge";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return `${hours}h ${remainMins}m ago`;
}

export default function TestNetDashboard() {
  const [forks, setForks] = useState<ForkInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchForks = useCallback(async () => {
    try {
      const result = await listForks();
      setForks(result);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load testnets",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Load forks on mount and poll every 15s
  useEffect(() => {
    fetchForks();
    const interval = setInterval(fetchForks, 15_000);
    return () => clearInterval(interval);
  }, [fetchForks]);

  const refreshFork = async (id: string) => {
    try {
      const updated = await getFork(id);
      setForks((prev) =>
        prev.map((f) => (f.id === id ? updated : f)),
      );
    } catch {
      // If fork is gone, refresh the whole list
      fetchForks();
    }
  };

  const handleCreated = (fork: ForkInfo) => {
    setForks((prev) => [...prev, fork]);
    setShowCreate(false);
    setExpandedId(fork.id);
  };

  const handleDestroyed = (id: string) => {
    setForks((prev) => prev.filter((f) => f.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="card p-2 sm:p-4 flex items-center justify-between mb-6">
        <div>
          <h2
            className="text-lg font-semibold theme-text"
          >
            Virtual TestNets
          </h2>
          <p
            className="text-sm mt-0.5 theme-text-secondary"
          >
            Fork PulseChain into isolated test environments powered by Anvil
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-md text-sm font-medium text-white theme-accent-solid"
        >
          + Create TestNet
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div
          className="p-4 rounded-lg mb-4 theme-danger-bg"
          style={{
            borderColor: "var(--color-danger)",
          }}
        >
          <p className="text-sm theme-danger">
            {error}
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="spinner" />
        </div>
      )}

      {/* Empty State */}
      {!loading && forks.length === 0 && !error && (
        <div
          className="text-center py-16 rounded-lg bs theme-card-bg"
        >
          <div
            className="text-4xl mb-3 theme-text-muted"
          >
            <Icon icon="heroicons:server-stack" className="w-12 h-12 mx-auto" />
          </div>
          <p
            className="text-sm font-medium theme-text-secondary"
          >
            No active testnets
          </p>
          <p
            className="text-xs mt-1 mb-4 theme-text-muted"
          >
            Create a virtual testnet to fork PulseChain into an isolated environment
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-md text-sm font-medium text-white theme-accent-solid"
          >
            + Create Your First TestNet
          </button>
        </div>
      )}

      {/* Fork Cards Grid */}
      {!loading && forks.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {forks.map((fork) => {
            const isExpanded = expandedId === fork.id;

            return (
              <div
                key={fork.id}
                className="rounded-lg transition-colors theme-card-bg"
                style={{
                  borderColor: isExpanded
                    ? "var(--color-accent)"
                    : "var(--color-border-default)",
                }}
              >
                {/* Card Header */}
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : fork.id)
                  }
                  className="w-full text-left px-4 py-3"
                  style={{ backgroundColor: "transparent" }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-row">
                      {/* Status dot */}
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0 theme-success-solid"
                      />
                      <div>
                        <div className="flex items-center gap-inline">
                          <h3
                            className="text-sm font-medium theme-text"
                          >
                            {fork.label}
                          </h3>
                          <ForkChainBadge chainId={fork.chainId} />
                        </div>
                        <div
                          className="flex items-center gap-row text-xs mt-0.5 theme-text-secondary"
                        >
                          <span>
                            Fork Block:{" "}
                            <span className="theme-mono theme-text"
                            >
                              {fork.blockNumber === "latest"
                                ? "latest"
                                : fork.blockNumber.toLocaleString()}
                            </span>
                          </span>
                          {fork.currentBlock != null && (
                            <span>
                              Current Block:{" "}
                              <span className="theme-mono theme-text"
                              >
                                {fork.currentBlock.toLocaleString()}
                              </span>
                            </span>
                          )}
                          <span>Port: {fork.port}</span>
                          <span>{timeAgo(fork.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-inline">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full theme-success-bg theme-success"
                      >
                        Active
                      </span>
                      <Icon
                        icon="heroicons:chevron-down-20-solid"
                        className="w-4 h-4 transition-transform theme-text-muted"
                        style={{
                          transform: isExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                        }}
                      />
                    </div>
                  </div>
                </button>

                {/* Expanded Controls */}
                {isExpanded && (
                  <div
                    className="px-4 pb-4 bs-t-muted"
                  >
                    <ForkControls
                      fork={fork}
                      onDestroyed={() => handleDestroyed(fork.id)}
                      onRefresh={() => refreshFork(fork.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      {showCreate && (
        <CreateForkDialog
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
