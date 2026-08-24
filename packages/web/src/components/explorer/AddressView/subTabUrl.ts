import type { AddressSubTab } from "./SubTabBar";

/**
 * Sub-tabs whose panel only has data for a contract — Source, Storage, Diff
 * and Re-verify all read compiled/deployed contract state that a plain EOA
 * does not have. Hidden rather than shown disabled: a tab that leads nowhere
 * is worse than an absent one.
 */
export const CONTRACT_ONLY_TABS: readonly AddressSubTab[] = [
  "source",
  "storage",
  "diff",
  "verify",
];

const ALL_TABS: readonly AddressSubTab[] = [
  "transactions",
  "tokens",
  ...CONTRACT_ONLY_TABS,
];

/** The default tab, and the fallback for anything that doesn't resolve. */
export const DEFAULT_SUB_TAB: AddressSubTab = "transactions";

function isAddressSubTab(value: string | null): value is AddressSubTab {
  return value !== null && (ALL_TABS as readonly string[]).includes(value);
}

/** The tabs available for this address, given whether it holds contract code. */
export function availableSubTabs(isContract: boolean): AddressSubTab[] {
  return isContract
    ? [...ALL_TABS]
    : ALL_TABS.filter((tab) => !CONTRACT_ONLY_TABS.includes(tab));
}

/**
 * Resolve the `?tab=` query value to a real, available tab.
 *
 * Three cases fall back to {@link DEFAULT_SUB_TAB}: no value in the URL, a
 * value that is not one of the six known keys, and a contract-only tab
 * requested for a plain EOA (or before the address's contract-ness is known
 * yet, i.e. `isContract` is still `false` while `AddressInfo` is loading).
 */
export function resolveActiveTab(
  urlTab: string | null,
  isContract: boolean,
): AddressSubTab {
  if (isAddressSubTab(urlTab) && availableSubTabs(isContract).includes(urlTab)) {
    return urlTab;
  }
  return DEFAULT_SUB_TAB;
}
