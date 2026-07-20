import type { AlertType } from "../../../api/alerts";
import { Dropdown } from "../../primitives/Dropdown";
import { ALERT_TYPES } from "./constants";
import { cardStyle, inputStyle, labelStyle } from "./styles";

interface Props {
  name: string;
  setName: (v: string) => void;
  type: AlertType;
  onTypeChange: (t: AlertType) => void;
  cooldown: string;
  setCooldown: (v: string) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export function BasicInfoCard({
  name,
  setName,
  type,
  onTypeChange,
  cooldown,
  setCooldown,
  enabled,
  setEnabled,
}: Props) {
  return (
    <div className="rounded-lg p-4 space-y-stack" style={cardStyle}>
      <h3
        className="text-sm font-semibold pb-3 bs-b-muted theme-text"
      >
        Basic Info
      </h3>

      <div>
        <label
          className="text-xs font-medium mb-1.5 block"
          style={labelStyle}
        >
          Alert Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Large Transfer Monitor"
          className="w-full px-3 py-2 rounded-md text-sm"
          style={inputStyle}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            className="text-xs font-medium mb-1.5 block"
            style={labelStyle}
          >
            Alert Type
          </label>
          <Dropdown<AlertType>
            value={type}
            onChange={onTypeChange}
            ariaLabel="Alert type"
            className="w-full"
            buttonClassName="w-full justify-between"
            options={ALERT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>

        <div>
          <label
            className="text-xs font-medium mb-1.5 block"
            style={labelStyle}
          >
            Cooldown (seconds)
          </label>
          <input
            type="number"
            value={cooldown}
            onChange={(e) => setCooldown(e.target.value)}
            placeholder="60"
            min={0}
            className="w-full px-3 py-2 rounded-md text-sm"
            style={inputStyle}
          />
        </div>
      </div>

      <div className="flex items-center gap-inline">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            backgroundColor: enabled
              ? "var(--color-accent)"
              : "var(--color-border-default)",
          }}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            style={{
              left: enabled ? "calc(100% - 18px)" : "2px",
            }}
          />
        </button>
        <span className="text-xs" style={labelStyle}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
    </div>
  );
}
