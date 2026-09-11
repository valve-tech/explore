import { useCallback, useSyncExternalStore } from "react";
import type { TimeDisplay } from "../format/time";

/**
 * Global "how do chain timestamps render" setting: an age ("1y 1mo ago"), a
 * UTC date, or both. `<Timestamp>` reads it, so every table follows one
 * choice. Same module-store shape as `testnets.ts`, so the settings page and
 * any other control can never disagree.
 */

const KEY = "explore.timeDisplay";
const MODES: readonly TimeDisplay[] = ["relative", "absolute", "both"];
const DEFAULT: TimeDisplay = "relative";
const listeners = new Set<() => void>();

function read(): TimeDisplay {
  try {
    const stored = localStorage.getItem(KEY);
    // An unknown value (an old build, a hand edit) falls back to the default
    // rather than rendering nothing.
    return MODES.includes(stored as TimeDisplay) ? (stored as TimeDisplay) : DEFAULT;
  } catch {
    // A private window or blocked storage must not break the page.
    return DEFAULT;
  }
}

let current = read();

export function getTimeDisplay(): TimeDisplay {
  return current;
}

export function setTimeDisplay(value: TimeDisplay): void {
  current = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage is a convenience here; the in-memory value still drives the UI.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimeDisplay(): [TimeDisplay, (value: TimeDisplay) => void] {
  const value = useSyncExternalStore(subscribe, getTimeDisplay, () => DEFAULT);
  const set = useCallback((next: TimeDisplay) => setTimeDisplay(next), []);
  return [value, set];
}
