import { TRANSFER_TOPIC } from "../tokenTransfers/transforms.js";

/**
 * How an address takes part in a transaction, from the facts the address page
 * already holds: the transaction body and its receipt.
 *
 * chifra lists a transaction for an address when the address appears ANYWHERE
 * in it — the sender, a log topic, a word of call data, or deep inside the
 * call trace. The list alone cannot say which, so a validator that only signs
 * a bridge message sees a page of strangers' transactions with nothing to show
 * why. This answers "why is this row here" without a trace read per row.
 *
 * "trace" is an inference, and it is the one kind this function cannot see
 * directly: the receipt answered, none of the visible places named the
 * address, so it must sit in the call trace (an internal call, an argument, a
 * return value). The transaction page names the exact call.
 */
export type AddressRelation =
  | "sender"
  | "recipient"
  | "creation"
  | "calldata"
  | "token"
  | "event"
  | "trace";

export interface RelationTx {
  from: string;
  to: string | null;
  input: string;
}

export interface RelationReceipt {
  contractAddress?: string | null;
  logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }>;
}

/**
 * The relations in a fixed order, deduplicated. An empty list means the
 * receipt did not answer and nothing visible matched: unknown, not "none".
 */
export function addressRelations(
  owner: string,
  tx: RelationTx,
  receipt: RelationReceipt | null,
): AddressRelation[] {
  const addr = owner.toLowerCase();
  const bare = addr.startsWith("0x") ? addr.slice(2) : addr;
  const found = new Set<AddressRelation>();

  if (tx.from.toLowerCase() === addr) found.add("sender");
  if (tx.to && tx.to.toLowerCase() === addr) found.add("recipient");
  // The selector is not data; skip it so a selector can never fake a match.
  if (tx.input.length > 10 && tx.input.slice(10).toLowerCase().includes(bare)) {
    found.add("calldata");
  }

  if (receipt) {
    if (receipt.contractAddress?.toLowerCase() === addr) found.add("creation");
    for (const log of receipt.logs) {
      const topics = log.topics.map((t) => t.toLowerCase());
      const isTransfer = topics[0] === TRANSFER_TOPIC;
      const inTopics = topics.slice(1).some((t) => t.endsWith(bare));
      if (isTransfer && (topics[1]?.endsWith(bare) || topics[2]?.endsWith(bare))) {
        found.add("token");
        continue;
      }
      if (
        log.address.toLowerCase() === addr ||
        inTopics ||
        log.data.toLowerCase().includes(bare)
      ) {
        found.add("event");
      }
    }
    if (found.size === 0) found.add("trace");
  }

  return RELATION_ORDER.filter((r) => found.has(r));
}

export const RELATION_ORDER: readonly AddressRelation[] = [
  "sender",
  "recipient",
  "creation",
  "calldata",
  "token",
  "event",
  "trace",
];
