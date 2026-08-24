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
        className={`relative h-4 w-[30px] rounded-full shadow-[0_0_0_1px_var(--color-border-default)] ${
          show ? "bg-(--color-accent-muted)" : "theme-tertiary-bg"
        }`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full transition-transform motion-reduce:transition-none ${
            show ? "translate-x-[14px] bg-(--color-accent)" : "translate-x-0.5 bg-(--color-text-muted)"
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
