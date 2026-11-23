import { Icon } from "@iconify/react";
import type { TransactionDetails } from "../../../api/explorer";
import { RELATION_BY_KIND } from "../../../lib/addressRelations";
import { SectionCard } from "./primitives";
import { findAddressOccurrences } from "./addressOccurrences";

/**
 * "How 0x5ECf…D74E takes part" — opened by `?for=<address>`, which the
 * address page's role icons write. It lists every place the address appears,
 * with the same icon vocabulary as the address table.
 */
export function AddressFocusSection({
  tx,
  decodedLogs,
  address,
}: {
  tx: TransactionDetails;
  decodedLogs: TransactionDetails["decodedLogs"];
  address: string;
}) {
  const found = findAddressOccurrences(tx, decodedLogs, address);
  const traceMissing = tx.internalTransactionsAvailable === false;
  return (
    <SectionCard title={`How ${address.slice(0, 6)}…${address.slice(-4)} takes part`} count={found.length}>
      <ul className="pt-3 space-y-tight" data-testid="address-focus">
        {found.map((o, i) => (
          <li key={i} className="flex items-start gap-inline text-sm theme-text">
            <Icon icon={RELATION_BY_KIND[o.kind].icon} className="w-4 h-4 mt-0.5 shrink-0 theme-accent" />
            <span className="min-w-0 break-words">{o.text}</span>
          </li>
        ))}
        {found.length === 0 && (
          <li className="text-sm theme-text-muted">
            {traceMissing
              ? "Not found in the envelope, the call data or the logs. The call trace did not load, so it may be in there."
              : "This address does not appear anywhere in this transaction."}
          </li>
        )}
      </ul>
    </SectionCard>
  );
}
