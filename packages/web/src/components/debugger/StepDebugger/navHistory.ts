/**
 * Browser-style bidirectional navigation history for the debugger source pane.
 * A pure module — the StepDebugger holds the state in useState and dispatches
 * actions through these reducers. Each entry captures BOTH the cursor step and
 * any active source-line override, so going back restores exactly what the
 * user was looking at.
 *
 * Why bidirectional: the user explicitly asked for browser-shape (back AND
 * forward, Cmd+[/]). A new navigation truncates anything ahead — same as a
 * web browser when you click a link after going back.
 */

export interface NavEntry {
  /** Cursor step, what useOpcodeNavigation's currentIndex should be. */
  step: number;
  /** Manual source-line override (null when the source-map drives the line). */
  overrideLine: number | null;
  /** Contract+file the override line lives in, when it's NOT the active frame's
   *  own source — e.g. a proxied call whose function is defined in the
   *  implementation. null/absent means "display the active frame's source". */
  overrideRef?: { addr: string; file: string } | null;
}

export interface NavHistoryState {
  entries: NavEntry[];
  /** -1 means "no nav has happened"; otherwise indexes into entries. */
  index: number;
}

export const emptyHistory: NavHistoryState = { entries: [], index: -1 };

const sameEntry = (a: NavEntry, b: NavEntry) =>
  a.step === b.step &&
  a.overrideLine === b.overrideLine &&
  (a.overrideRef?.addr ?? null) === (b.overrideRef?.addr ?? null) &&
  (a.overrideRef?.file ?? null) === (b.overrideRef?.file ?? null);

/** The implicit initial entry — what a freshly-loaded trace shows before any
 *  user navigation. Synthesized by the first push so back can return here. */
const initialEntry: NavEntry = { step: 0, overrideLine: null };

/**
 * Append a new entry, truncating anything ahead of the current index — i.e.,
 * starting fresh forward history from this point on. A no-op if the entry is
 * identical to the current one (avoids history growing when the user clicks
 * the same place repeatedly).
 *
 * On the first push (empty history), implicitly seeds `initialEntry` ahead of
 * the new entry so `canGoBack` becomes true and `goBack` returns to step 0 —
 * matching a fresh browser tab whose blank page is in history.
 */
export function pushEntry(state: NavHistoryState, entry: NavEntry): NavHistoryState {
  if (state.entries.length === 0) {
    return sameEntry(initialEntry, entry)
      ? { entries: [initialEntry], index: 0 }
      : { entries: [initialEntry, entry], index: 1 };
  }
  const current = state.entries[state.index];
  if (current && sameEntry(current, entry)) return state;
  const kept = state.entries.slice(0, state.index + 1);
  return { entries: [...kept, entry], index: kept.length };
}

/** Step back by one entry. Returns the same state if already at the start. */
export function goBack(state: NavHistoryState): NavHistoryState {
  if (state.index <= 0) return state;
  return { entries: state.entries, index: state.index - 1 };
}

/** Step forward by one entry. Returns the same state if no future exists. */
export function goForward(state: NavHistoryState): NavHistoryState {
  if (state.index >= state.entries.length - 1) return state;
  return { entries: state.entries, index: state.index + 1 };
}

export const canGoBack = (state: NavHistoryState): boolean => state.index > 0;
export const canGoForward = (state: NavHistoryState): boolean =>
  state.index < state.entries.length - 1;

/** The entry at the current index, or null if history is empty. */
export const currentEntry = (state: NavHistoryState): NavEntry | null =>
  state.index >= 0 ? state.entries[state.index] ?? null : null;
