import { chainRoutePrefix } from "./chainScope";

/**
 * Canonical block-explorer routes, per EIP-3091
 * (https://eips.ethereum.org/EIPS/eip-3091). All scan navigation goes through
 * here so the path scheme stays consistent — never query strings.
 *
 *   tx       → /tx/<hash>
 *   block    → /block/<number|hash>
 *   address  → /address/<address>   (EOA or unknown)
 *   contract → /token/<address>     (a contract-detail page)
 *
 * Pass `chainId` to scope the path to one chain — the CAIP-2 prefix goes in
 * front: `/eip155/369/tx/<hash>`. Omit it for the chain-less form, which the
 * address, token and block-number routes render as "every chain". This is the
 * only place an entity path is built; never concatenate one by hand.
 */
export type ScanKind = "tx" | "block" | "address" | "contract";

function bareScanPath(kind: ScanKind, value: string): string {
  switch (kind) {
    case "tx":
      return `/tx/${value}`;
    case "block":
      return `/block/${value}`;
    case "address":
      return `/address/${value}`;
    case "contract":
      return `/token/${value}`;
  }
}

export function scanPath(kind: ScanKind, value: string, chainId?: number): string {
  const bare = bareScanPath(kind, value);
  // An unregistered chain yields an empty prefix, so the caller gets the bare
  // path rather than a route that resolves to nothing.
  return chainId === undefined ? bare : `${chainRoutePrefix(chainId)}${bare}`;
}
