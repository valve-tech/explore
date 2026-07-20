import { ADDRESS_RE } from "./api";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg-input)",
  boxShadow: "0 0 0 1px var(--color-border-default)",
  color: "var(--color-text-primary)",
  padding: "8px 12px",
  fontSize: "13px",
  fontFamily: "var(--font-mono)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  display: "block",
  marginBottom: "6px",
};

interface Props {
  addressA: string;
  setAddressA: (v: string) => void;
  addressB: string;
  setAddressB: (v: string) => void;
  loading: boolean;
  onCompare: () => void;
}

export function InputCard({
  addressA,
  setAddressA,
  addressB,
  setAddressB,
  loading,
  onCompare,
}: Props) {
  const isValidA = ADDRESS_RE.test(addressA);
  const isValidB = ADDRESS_RE.test(addressB);
  const sameAddress =
    isValidA && isValidB && addressA.toLowerCase() === addressB.toLowerCase();
  const canCompare = isValidA && isValidB && !sameAddress;

  return (
    <div className="card" style={{ marginBottom: "20px" }}>
      <div
        className="card-divider"
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <span
          className="theme-text"
          style={{
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Contract Diff
        </span>
        <span className="theme-text-muted" style={{ fontSize: "12px" }}>
          Compare verified source code between two contracts
        </span>
      </div>

      <div
        className="grid grid-cols-1 sm:grid-cols-2"
        style={{
          padding: "20px 16px",
          gap: "16px",
          alignItems: "end",
        }}
      >
        <AddressField
          label="Contract A"
          value={addressA}
          onChange={setAddressA}
          isValid={!addressA || isValidA}
        />
        <AddressField
          label="Contract B"
          value={addressB}
          onChange={setAddressB}
          isValid={!addressB || isValidB}
        />
      </div>

      <div
        style={{
          padding: "0 16px 20px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <button
          onClick={onCompare}
          disabled={!canCompare || loading}
          style={{
            padding: "8px 20px",
            background:
              canCompare && !loading
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            color:
              canCompare && !loading ? "#fff" : "var(--color-text-muted)",
            border: "none",
            cursor: canCompare && !loading ? "pointer" : "not-allowed",
            fontWeight: 600,
            fontSize: "13px",
            transition: "background 0.15s",
          }}
        >
          {loading ? "Comparing…" : "Compare"}
        </button>

        {sameAddress && (
          <span className="theme-warning" style={{ fontSize: "12px" }}>
            Addresses must be different
          </span>
        )}

        {loading && <div className="spinner" />}
      </div>
    </div>
  );
}

function AddressField({
  label,
  value,
  onChange,
  isValid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isValid: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="text"
        placeholder="0x..."
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        style={{
          ...inputStyle,
          borderColor: isValid
            ? "var(--color-border-default)"
            : "var(--color-danger)",
        }}
      />
      {!isValid && (
        <div
          className="theme-danger"
          style={{
            fontSize: "11px",
            marginTop: "4px",
          }}
        >
          Invalid address
        </div>
      )}
    </div>
  );
}
