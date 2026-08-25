export type AddressSubTab =
  | "transactions"
  | "tokens"
  | "source"
  | "storage"
  | "diff"
  | "verify";

/** One of the contract-only tabs appended after Transactions/Tokens. */
export interface ExtraSubTab {
  key: AddressSubTab;
  label: string;
}

interface Props {
  active: AddressSubTab;
  onSelect: (tab: AddressSubTab) => void;
  txCount: number;
  tokenCount: number;
  /** Contract-only tabs (Source/Storage/Diff/Re-verify) — empty for a plain EOA. */
  extraTabs?: ExtraSubTab[];
}

function TabButton({
  active,
  onClick,
  label,
  count = 0,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      // The active tab is signalled by a 2px underline and a text colour.
      // Neither reaches a screen reader, so state it.
      aria-current={active ? "page" : undefined}
      className={`px-4 py-2.5 text-sm font-medium transition-colors shrink-0 ${
        active ? "theme-text" : "theme-text-secondary"
      }`}
      style={{
        boxShadow: active
          ? "0 2px 0 0 var(--color-accent)"
          : "0 2px 0 0 transparent",
        backgroundColor: "transparent",
      }}
    >
      {label}
      {count > 0 && (
        <span
          className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full theme-accent-bg theme-accent"
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function SubTabBar({
  active,
  onSelect,
  txCount,
  tokenCount,
  extraTabs = [],
}: Props) {
  return (
    // `aria-label` is load-bearing beyond accessibility: "Storage" is also an
    // AddressHeader quick-action button and a sidebar nav item, so a query for
    // it matches three different controls. Naming this strip is what lets a
    // caller — or a test — mean this one.
    <nav aria-label="Address sections" className="flex gap-0 bs-b overflow-x-auto">
      <TabButton
        active={active === "transactions"}
        onClick={() => onSelect("transactions")}
        label="Transactions"
        count={txCount}
      />
      <TabButton
        active={active === "tokens"}
        onClick={() => onSelect("tokens")}
        label="Token Balances"
        count={tokenCount}
      />
      {extraTabs.map((t) => (
        <TabButton
          key={t.key}
          active={active === t.key}
          onClick={() => onSelect(t.key)}
          label={t.label}
        />
      ))}
    </nav>
  );
}
