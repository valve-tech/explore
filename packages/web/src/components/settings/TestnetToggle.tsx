import { useShowTestnets, visibleChainIds } from "../../lib/settings/testnets";
import { CHAINS } from "../../lib/chains";

/**
 * The testnet switch. Rendered in the app footer and in /settings; both read
 * and write the one store, so they can never disagree.
 *
 * Built from a button with role="switch" rather than a native checkbox —
 * native form controls are banned in this codebase because the browser owns
 * their appearance and they always read as foreign chrome.
 */
export default function TestnetToggle() {
  const [show, setShow] = useShowTestnets();
  const visible = visibleChainIds().length;

  return (
    <span className="inline-flex items-center gap-inline">
      <button
        type="button"
        role="switch"
        aria-checked={show}
        aria-label="Show testnets"
        onClick={() => setShow(!show)}
        className={`relative h-4 w-[30px] shrink-0 shadow-[0_0_0_1px_var(--color-border-default)] ${
          show ? "bg-(--color-accent-muted)" : "theme-tertiary-bg"
        }`}
      >
        {/*
         * `left-0.5` is load-bearing, not decoration. Without an explicit
         * `left`, an absolutely positioned child resolves to its STATIC
         * position — which the browser computed as 15px inside this 30px
         * track, so `translate-x-[14px]` put the knob at 29px and it escaped
         * the track entirely and overlapped the "Testnets" label next to it.
         * Anchoring at 2px makes the travel deterministic: 2→14 when off,
         * 16→28 when on, inside a 30px track with a 2px margin each side.
         *
         * No `rounded-full`: `index.css` sets `* { border-radius: 0
         * !important }` app-wide, so a radius here is dead CSS. The switch is
         * square on purpose, like every other control in Explore.
         */}
        <span
          className={`absolute top-0.5 left-0.5 size-3 transition-transform motion-reduce:transition-none ${
            show ? "translate-x-[14px] bg-(--color-accent)" : "translate-x-0 bg-(--color-text-muted)"
          }`}
        />
      </button>
      <span className="theme-text-secondary theme-mono text-xs">Testnets</span>
      <span className="theme-text-muted theme-mono text-[10px] rounded px-1.5 shadow-[0_0_0_1px_var(--color-border-default)]">
        {visible} of {CHAINS.length} chains
      </span>
    </span>
  );
}
