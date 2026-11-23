import type { TransactionDetails } from "../../../api/explorer";
import type { AddressRelation } from "../../../lib/addressRelations";

/**
 * Every place an address appears in one transaction, in reading order: the
 * envelope, the call data, the token transfers, the logs, then the call trace.
 *
 * The address page can only say "this address is inside the trace"; this is
 * where the reader learns WHICH call. The motivating case is a bridge
 * validator: it never sends, receives or emits anything, and appears only as
 * the value an ecrecover returns and the argument to isValidator(address).
 */
export interface AddressOccurrence {
  kind: AddressRelation;
  text: string;
}

type DecodedLog = TransactionDetails["decodedLogs"][number];

/** The ecrecover precompile. A return value from it names a signer. */
const ECRECOVER = "0x0000000000000000000000000000000000000001";

export function findAddressOccurrences(
  tx: Pick<
    TransactionDetails,
    "from" | "to" | "input" | "contractAddress" | "rawLogs" | "tokenTransfers" | "internalTransactions"
  >,
  decodedLogs: readonly DecodedLog[],
  address: string,
): AddressOccurrence[] {
  const addr = address.toLowerCase();
  const bare = addr.replace(/^0x/, "");
  const same = (a: string | null | undefined) => !!a && a.toLowerCase() === addr;
  const names = (hex: string | undefined, skip = 0) =>
    !!hex && hex.slice(2 + skip).toLowerCase().includes(bare);
  const out: AddressOccurrence[] = [];

  if (same(tx.from)) out.push({ kind: "sender", text: "Sent this transaction." });
  if (same(tx.to)) out.push({ kind: "recipient", text: "This transaction was sent to it." });
  if (same(tx.contractAddress)) out.push({ kind: "creation", text: "This transaction created it." });
  if (names(tx.input, 8)) {
    out.push({ kind: "calldata", text: "The transaction's call data names it." });
  }

  for (const t of tx.tokenTransfers) {
    const symbol = t.tokenSymbol || "token";
    if (same(t.from)) out.push({ kind: "token", text: `Sent ${symbol} to ${short(t.to)}.` });
    if (same(t.to)) out.push({ kind: "token", text: `Received ${symbol} from ${short(t.from)}.` });
  }

  for (const log of tx.rawLogs) {
    const decoded = decodedLogs.find((d) => d.logIndex === log.logIndex);
    const name = decoded?.eventName ? `${decoded.eventName} ` : "";
    const label = `Log #${log.logIndex} ${name}`.trimEnd();
    if (same(log.address)) out.push({ kind: "event", text: `${label}: emitted by it.` });
    const arg = decoded?.args.find((a) => typeof a.value === "string" && same(a.value));
    if (arg) {
      out.push({ kind: "event", text: `${label}: it is the \`${arg.name}\` argument.` });
      continue;
    }
    const topic = log.topics.findIndex((t, i) => i > 0 && t.toLowerCase().endsWith(bare));
    if (topic > 0) out.push({ kind: "event", text: `${label}: topic ${topic} names it.` });
    else if (names(log.data)) out.push({ kind: "event", text: `${label}: its data names it.` });
  }

  tx.internalTransactions.forEach((call, i) => {
    const where = `Call ${i + 1} (${call.type}${call.depth ? `, depth ${call.depth}` : ""})`;
    const fn = call.methodSignature ? ` ${call.methodSignature}` : "";
    if (same(call.from)) {
      out.push({ kind: "trace", text: `${where}: it calls${fn} on ${short(call.to)}.` });
    }
    if (same(call.to)) out.push({ kind: "trace", text: `${where}: ${short(call.from)} calls it${fn}.` });
    if (names(call.input, 8)) {
      out.push({
        kind: "trace",
        text: `${where}: an argument of${fn || " the call"} on ${short(call.to)}.`,
      });
    }
    if (names(call.output)) {
      out.push({
        kind: "trace",
        text:
          call.to.toLowerCase() === ECRECOVER
            ? `${where}: ecrecover returns it, so it signed data this transaction checks.`
            : `${where}: ${short(call.to)} returns it${fn ? ` from${fn}` : ""}.`,
      });
    }
  });

  return out;
}

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
