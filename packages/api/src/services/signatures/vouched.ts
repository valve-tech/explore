import { toFunctionSelector } from "viem";

/**
 * The signatures we are willing to vouch for.
 *
 * A 4byte selector with several candidates is not automatically a guess. On
 * 2026-08-25 we sampled 250 recent transactions across all four chains and
 * looked at every row the UI marked as uncertain. Four distinct selectors
 * carried more than one candidate:
 *
 *   0xa9059cbb  37 rows  6 candidates  transfer
 *   0x23b872dd   8 rows  5 candidates  transferFrom
 *   0x5c11d795   1 row   2 candidates  swapExactTokensForTokensSupportingFeeOnTransferTokens
 *   0x60806040   1 row   6 candidates  atInversebrah(…)
 *
 * The first three are ERC-20 and Uniswap V2. Nobody doubts them. The fourth
 * is not a selector at all — see `UNRESOLVABLE_SELECTORS`. So the count told
 * us "six" for the row that was certainly right and "six" for the row that
 * was certainly wrong. A number that takes the same value on the best case
 * and the worst case is not a signal, and the page proved it: on one address
 * feed `transfer(address,uint256)` and `atInversebrah(…)` sat three rows
 * apart wearing the identical superscript 6.
 *
 * The list below is the fix. These signatures are what real contracts
 * compile — they are in EIP text, in OpenZeppelin, in the Uniswap V2
 * periphery — and the other names sharing their selectors are gas-token-era
 * mined spam. When the directory hands us one of these, we stop counting and
 * say the name is settled.
 *
 * Two rules keep the list honest:
 *
 * 1. **Selectors are derived, never typed.** `toFunctionSelector` hashes each
 *    string at module load. A typo in a signature produces a selector that
 *    matches no real call, so it is dead weight — it can never mislabel one.
 * 2. **The match is on the whole signature, not the name.** 0xa9059cbb also
 *    holds `transfer(bytes4[9],bytes5[6],int48[11])`. Comparing names alone
 *    would vouch for that one too.
 *
 * Adding an entry is a claim that the signature is canonical for its
 * selector. Do not add a signature you merely saw in the wild.
 */
export const VOUCHED_SIGNATURES = [
  // ERC-20 (EIP-20), plus the OpenZeppelin allowance helpers and EIP-2612.
  "name()",
  "symbol()",
  "decimals()",
  "totalSupply()",
  "balanceOf(address)",
  "transfer(address,uint256)",
  "transferFrom(address,address,uint256)",
  "approve(address,uint256)",
  "allowance(address,address)",
  "increaseAllowance(address,uint256)",
  "decreaseAllowance(address,uint256)",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",

  // ERC-165.
  "supportsInterface(bytes4)",

  // ERC-721.
  "ownerOf(uint256)",
  "getApproved(uint256)",
  "setApprovalForAll(address,bool)",
  "isApprovedForAll(address,address)",
  "tokenURI(uint256)",
  "safeTransferFrom(address,address,uint256)",
  "safeTransferFrom(address,address,uint256,bytes)",

  // ERC-1155.
  "uri(uint256)",
  "balanceOfBatch(address[],uint256[])",
  "safeTransferFrom(address,address,uint256,uint256,bytes)",
  "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",

  // WETH9 — and every wrapped-native clone on chains 369, 943 and 11155111.
  "deposit()",
  "withdraw(uint256)",

  // Ownable.
  "owner()",
  "transferOwnership(address)",
  "renounceOwnership()",

  // ERC-1967 proxy upgrades.
  "upgradeTo(address)",
  "upgradeToAndCall(address,bytes)",

  // Uniswap V2 pair.
  "getReserves()",
  "swap(uint256,uint256,address,bytes)",
  "mint(address)",
  "burn(address)",
  "sync()",
  "skim(address)",

  // Uniswap V2 router — the whole swap and liquidity surface, because
  // PulseChain's DEXes are V2 forks and this is most of chain 369's traffic.
  "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
  "swapExactETHForTokens(uint256,address[],address,uint256)",
  "swapTokensForExactETH(uint256,uint256,address[],address,uint256)",
  "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  "swapETHForExactTokens(uint256,address[],address,uint256)",
  "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)",
  "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)",
  "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)",
  "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
  "removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)",

  // Multicall.
  "multicall(bytes[])",
  "multicall(uint256,bytes[])",
] as const;

/**
 * Selector to the one signature we vouch for.
 *
 * Built once, from keccak, so no hand-typed selector can be wrong. Two
 * entries could in principle hash to the same selector; the map keeps the
 * later one, and `vouchedSignatures` exposes the size so a test can prove it
 * did not happen.
 */
const BY_SELECTOR: ReadonlyMap<string, string> = new Map(
  VOUCHED_SIGNATURES.map((sig) => [toFunctionSelector(sig), sig]),
);

/** The whole table, for tests. Selector to signature. */
export function vouchedSignatures(): ReadonlyMap<string, string> {
  return BY_SELECTOR;
}

/**
 * True when this exact signature is the canonical one for this selector.
 *
 * Both halves matter. `isVouched("0xa9059cbb", "transfer(address,uint256)")`
 * is true; `isVouched("0xa9059cbb", "transfer(bytes4[9],bytes5[6],int48[11])")`
 * is false, though the names match and the selector is right.
 */
export function isVouched(selector: string, textSignature: string): boolean {
  return BY_SELECTOR.get(selector.toLowerCase()) === textSignature;
}
