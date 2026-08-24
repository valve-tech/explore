import { useCallback, useSyncExternalStore } from "react";
import { CHAINS } from "../chains";

/**
 * Global "show testnets" setting.
 *
 * This looks like a display preference and is actually a cost control. With
 * testnets off, every chain-less page probes two chains instead of four, which
 * halves the RPC budget the multichain address view spends. Prod has 429'd on
 * Ethereum before, so that halving is the point.
 *
 * It therefore must live somewhere the FETCH layer can read, not in component
 * state — otherwise the server still probes every chain and the saving never
 * happens. Hence a module-level store with a non-reactive getter alongside the
 * hook.
 *
 * An explicit testnet URL still works. `/eip155/943/tx/0x…` is a stated scope
 * and outranks a display preference.
 */

const KEY = "explore.showTestnets";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    // Absent means "not yet chosen", which defaults to showing everything.
    return localStorage.getItem(KEY) !== "0";
  } catch {
    // A private window or blocked storage must not break the page.
    return true;
  }
}

let current = read();

export function getShowTestnets(): boolean {
  return current;
}

export function setShowTestnets(value: boolean): void {
  current = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    // Storage is a convenience here; the in-memory value still drives the UI.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowTestnets(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getShowTestnets, () => true);
  const set = useCallback((next: boolean) => setShowTestnets(next), []);
  return [value, set];
}

/** The chain ids a chain-less page should probe, ascending. */
export function visibleChainIds(): number[] {
  return CHAINS.filter((c) => (getShowTestnets() ? true : !c.testnet))
    .map((c) => c.id)
    .sort((a, b) => a - b);
}
