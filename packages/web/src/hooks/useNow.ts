import { useSyncExternalStore } from "react";

/**
 * Shared once-per-second clock. One timer for the whole app, and the snapshot is
 * whole seconds, so subscribers only re-render when the second actually changes
 * (useSyncExternalStore bails on an unchanged snapshot). Subscribe it from the
 * SMALLEST component that shows a live time (e.g. a single table cell) so the
 * tick never re-renders heavy siblings.
 */

let nowSec = Math.floor(Date.now() / 1000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  nowSec = Math.floor(Date.now() / 1000);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timer === null) timer = setInterval(tick, 1000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return nowSec;
}

/** Current time in whole seconds, ticking once per second from a shared timer. */
export function useNowSeconds(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
