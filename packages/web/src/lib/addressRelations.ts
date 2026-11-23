/**
 * The one vocabulary for "how an address takes part in a transaction".
 *
 * The API classifies each address-page row into these kinds
 * (packages/api/src/services/explorer/addresses/relations.ts); the address
 * table lights an icon per kind, the filter bar toggles them, and the
 * transaction page's "How this address takes part" section uses the same
 * icons and words. Keep one order and one label per kind everywhere.
 */
export type AddressRelation =
  | "sender"
  | "recipient"
  | "creation"
  | "calldata"
  | "token"
  | "event"
  | "trace";

export interface RelationInfo {
  kind: AddressRelation;
  icon: string;
  /** A short name for the filter bar. */
  label: string;
  /** One sentence for the tooltip, written about "this address". */
  description: string;
}

export const RELATIONS: readonly RelationInfo[] = [
  {
    kind: "sender",
    icon: "heroicons:arrow-up-right",
    label: "Sender",
    description: "This address sent the transaction.",
  },
  {
    kind: "recipient",
    icon: "heroicons:arrow-down-left",
    label: "Recipient",
    description: "The transaction was sent to this address.",
  },
  {
    kind: "creation",
    icon: "heroicons:sparkles",
    label: "Created",
    description: "The transaction created this contract.",
  },
  {
    kind: "calldata",
    icon: "heroicons:code-bracket",
    label: "Call data",
    description: "The transaction's call data names this address.",
  },
  {
    kind: "token",
    icon: "heroicons:currency-dollar",
    label: "Token transfer",
    description: "A token transfer in this transaction goes from or to this address.",
  },
  {
    kind: "event",
    icon: "heroicons:bell",
    label: "Event log",
    description: "An event log in this transaction comes from or names this address.",
  },
  {
    kind: "trace",
    icon: "heroicons:share",
    label: "Trace only",
    description:
      "This address appears only inside the call trace: an internal call, an argument or a return value. Open the transaction to see which call.",
  },
];

export const RELATION_BY_KIND: Record<AddressRelation, RelationInfo> = Object.fromEntries(
  RELATIONS.map((r) => [r.kind, r]),
) as Record<AddressRelation, RelationInfo>;
