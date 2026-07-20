import { useState } from "react";
import { Icon } from "@iconify/react";
import type { StateOverride } from "../types";

interface StateOverridesProps {
  overrides: StateOverride[];
  onChange: (overrides: StateOverride[]) => void;
}

function StorageSlotEditor({
  storage,
  onChange,
}: {
  storage: Record<string, string>;
  onChange: (storage: Record<string, string>) => void;
}) {
  const entries = Object.entries(storage);

  const addSlot = () => {
    onChange({ ...storage, "": "" });
  };

  const updateSlot = (oldKey: string, newKey: string, newValue: string) => {
    const updated = { ...storage };
    if (oldKey !== newKey) {
      delete updated[oldKey];
    }
    updated[newKey] = newValue;
    onChange(updated);
  };

  const removeSlot = (key: string) => {
    const updated = { ...storage };
    delete updated[key];
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium theme-text-secondary"
        >
          Storage Slots
        </label>
        <button
          type="button"
          onClick={addSlot}
          className="text-xs px-2 py-0.5 rounded theme-accent theme-accent-bg"
        >
          + Add Slot
        </button>
      </div>
      {entries.map(([key, val], idx) => (
        <div key={idx} className="flex gap-inline items-center">
          <input
            type="text"
            value={key}
            onChange={(e) => updateSlot(key, e.target.value, val)}
            placeholder="0x0 (slot)"
            className="flex-1 px-2 py-1.5 rounded bs text-xs theme-mono theme-input-bg theme-text"
          />
          <span className="theme-text-muted">=</span>
          <input
            type="text"
            value={val}
            onChange={(e) => updateSlot(key, key, e.target.value)}
            placeholder="0x... (value)"
            className="flex-1 px-2 py-1.5 rounded bs text-xs theme-mono theme-input-bg theme-text"
          />
          <button
            type="button"
            onClick={() => removeSlot(key)}
            className="p-1 rounded hover:opacity-80 theme-danger"
          >
            <Icon icon="heroicons:x-mark" className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function SingleOverride({
  override,
  index,
  onChange,
  onRemove,
}: {
  override: StateOverride;
  index: number;
  onChange: (index: number, updated: StateOverride) => void;
  onRemove: (index: number) => void;
}) {
  const [showStorage, setShowStorage] = useState(
    override.storage ? Object.keys(override.storage).length > 0 : false,
  );

  const update = (field: keyof StateOverride, value: unknown) => {
    onChange(index, { ...override, [field]: value });
  };

  return (
    <div
      className="rounded-md bs-muted p-3 space-y-3 theme-tertiary-bg"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium theme-text-secondary">
          Override #{index + 1}
        </span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80 theme-danger theme-danger-bg"
        >
          Remove
        </button>
      </div>

      <div>
        <label className="text-xs mb-1 block theme-text-secondary">
          Address
        </label>
        <input
          type="text"
          value={override.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="0x..."
          className="w-full px-2 py-1.5 rounded bs text-sm theme-mono theme-input-bg theme-text"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-row">
        <div>
          <label className="text-xs mb-1 block theme-text-secondary">
            Balance (wei)
          </label>
          <input
            type="text"
            value={override.balance ?? ""}
            onChange={(e) => update("balance", e.target.value)}
            placeholder="0x..."
            className="w-full px-2 py-1.5 rounded bs text-sm theme-mono theme-input-bg theme-text"
          />
        </div>
        <div>
          <label className="text-xs mb-1 block theme-text-secondary">
            Nonce
          </label>
          <input
            type="text"
            value={override.nonce ?? ""}
            onChange={(e) => update("nonce", e.target.value)}
            placeholder="0x0"
            className="w-full px-2 py-1.5 rounded bs text-sm theme-mono theme-input-bg theme-text"
          />
        </div>
      </div>

      <div>
        <label className="text-xs mb-1 block theme-text-secondary">
          Code (bytecode)
        </label>
        <input
          type="text"
          value={override.code ?? ""}
          onChange={(e) => update("code", e.target.value)}
          placeholder="0x608060..."
          className="w-full px-2 py-1.5 rounded bs text-sm theme-mono theme-input-bg theme-text"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => {
            setShowStorage(!showStorage);
            if (!showStorage && !override.storage) {
              update("storage", {});
            }
          }}
          className="text-xs flex items-center gap-tight theme-accent"
        >
          <Icon
            icon="heroicons:chevron-right"
            className={`w-3 h-3 transition-transform ${showStorage ? "rotate-90" : ""}`}
          />
          Storage Overrides
        </button>
        {showStorage && (
          <div className="mt-2">
            <StorageSlotEditor
              storage={override.storage ?? {}}
              onChange={(s) => update("storage", s)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function StateOverrides({ overrides, onChange }: StateOverridesProps) {
  const [expanded, setExpanded] = useState(false);

  const addOverride = () => {
    onChange([...overrides, { address: "", balance: "", nonce: "", code: "", storage: {} }]);
    setExpanded(true);
  };

  const updateOverride = (index: number, updated: StateOverride) => {
    const next = [...overrides];
    next[index] = updated;
    onChange(next);
  };

  const removeOverride = (index: number) => {
    onChange(overrides.filter((_, i) => i !== index));
  };

  return (
    <div
      className="rounded-lg bs overflow-hidden theme-card-bg"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
        style={{
          color: "var(--color-text-primary)",
          backgroundColor: "transparent",
        }}
      >
        <span className="flex items-center gap-inline">
          <Icon
            icon="heroicons:chevron-right"
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          State Overrides
        </span>
        {overrides.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full theme-accent-bg theme-accent"
          >
            {overrides.length} override{overrides.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {expanded && (
        <div
          className="px-4 pb-4 bs-t-muted space-y-3"
          style={{}}
        >
          <div className="pt-3">
            {overrides.map((o, i) => (
              <div key={i} className="mb-3">
                <SingleOverride
                  override={o}
                  index={i}
                  onChange={updateOverride}
                  onRemove={removeOverride}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addOverride}
            className="w-full py-2 rounded-md bs border-dashed text-sm transition-colors hover:opacity-80"
            style={{
              color: "var(--color-text-secondary)",
              backgroundColor: "transparent",
            }}
          >
            + Add State Override
          </button>
        </div>
      )}
    </div>
  );
}
