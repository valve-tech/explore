import type { TransactionDetails } from "../../../api/explorer";
import { SectionCard, type AddressNavigate } from "./primitives";
import { useActiveChainId } from "../../../lib/activeChain";
import { chainSymbol } from "../../../lib/chains";
import { CallTree } from "./CallTree";

export function InternalTxSection({
  internalTransactions,
  available = true,
  onNavigate,
}: {
  internalTransactions: TransactionDetails["internalTransactions"];
  /**
   * False when no trace source answered. The empty list then means "we do
   * not know", so the section withholds its count and says so instead of
   * printing "No internal transactions" — which would be a claim about the
   * chain we cannot back.
   */
  available?: boolean;
  onNavigate: AddressNavigate;
}) {
  const symbol = chainSymbol(useActiveChainId());

  return (
    <SectionCard
      title="Internal Transactions"
      count={available ? internalTransactions.length : undefined}
      defaultOpen={!available}
    >
      <div className="pt-3">
        {internalTransactions.length === 0 ? (
          <div className="p-4 text-center text-sm theme-text-muted">
            {available
              ? "No internal transactions"
              : "Could not load internal transactions — no trace source answered for this chain."}
          </div>
        ) : (
          <div className="bs-muted">
            <CallTree
              calls={internalTransactions}
              symbol={symbol}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
