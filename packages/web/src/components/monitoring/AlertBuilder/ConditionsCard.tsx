import type { AlertConditions, AlertType } from "../../../api/alerts";
import { Dropdown } from "../../primitives/Dropdown";
import { cardStyle, inputStyle, labelStyle } from "./styles";

interface Props {
  type: AlertType;
  conditions: AlertConditions;
  setConditions: (c: AlertConditions) => void;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        className="text-xs font-medium mb-1.5 block"
        style={labelStyle}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md text-sm"
        style={inputStyle}
      />
      {hint && (
        <p
          className="text-xs mt-1 theme-text-muted"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function ConditionsCard({ type, conditions, setConditions }: Props) {
  const patch = (updates: Partial<AlertConditions>) =>
    setConditions({ ...conditions, ...updates });

  return (
    <div className="rounded-lg p-4 space-y-stack" style={cardStyle}>
      <h3
        className="text-sm font-semibold pb-3 bs-b-muted theme-text"
      >
        Conditions
      </h3>

      {(type === "address_activity" || type === "failed_tx") && (
        <TextField
          label="Watch Address"
          value={conditions.address ?? ""}
          onChange={(v) => patch({ address: v })}
          placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f..."
        />
      )}

      {type === "contract_event" && (
        <>
          <TextField
            label="Contract Address"
            value={conditions.contractAddress ?? ""}
            onChange={(v) => patch({ contractAddress: v })}
            placeholder="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
          />
          <TextField
            label="Event Signature"
            value={conditions.eventSignature ?? ""}
            onChange={(v) => patch({ eventSignature: v })}
            placeholder="Transfer(address,address,uint256)"
            hint="Full event signature with types, e.g. Transfer(address,address,uint256)"
          />
        </>
      )}

      {type === "function_call" && (
        <>
          <TextField
            label="Contract Address"
            value={conditions.contractAddress ?? ""}
            onChange={(v) => patch({ contractAddress: v })}
            placeholder="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
          />
          <TextField
            label="Function Selector (4 bytes hex)"
            value={conditions.functionSelector ?? ""}
            onChange={(v) => patch({ functionSelector: v })}
            placeholder="0xa9059cbb"
            hint="First 4 bytes of the keccak256 hash of the function signature"
          />
        </>
      )}

      {type === "balance_threshold" && (
        <>
          <TextField
            label="Watch Address"
            value={conditions.address ?? ""}
            onChange={(v) => patch({ address: v })}
            placeholder="0x742d35Cc6634C0532925a3b844Bc9e7595f..."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField
              label="Threshold (PLS)"
              value={conditions.threshold ?? ""}
              onChange={(v) => patch({ threshold: v })}
              placeholder="1000"
            />
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={labelStyle}
              >
                Direction
              </label>
              <Dropdown<"above" | "below">
                value={conditions.direction ?? "below"}
                onChange={(v) => patch({ direction: v })}
                ariaLabel="Direction"
                className="w-full"
                buttonClassName="w-full justify-between"
                options={[
                  { value: "above", label: "Above" },
                  { value: "below", label: "Below" },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
