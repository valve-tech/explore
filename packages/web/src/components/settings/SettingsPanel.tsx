import { useState } from "react";
import { Icon } from "@iconify/react";
import {
  resolveApiBase,
  getApiBaseOverride,
  setApiBaseOverride,
  clearApiBaseOverride,
} from "../../lib/apiBase";
import { RpcChainRow } from "./RpcChainRow";
import {
  isDesktopNotifyEnabled,
  setDesktopNotifyEnabled,
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
  type NotifyPermission,
} from "../../lib/watcher/desktopNotify";
import { CHAINS } from "../../lib/chains";
import { BUILD_INFO } from "../../lib/buildInfo";
import TestnetToggle from "./TestnetToggle";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 transition-colors shrink-0"
      style={{
        backgroundColor: checked ? "var(--color-accent)" : "var(--color-bg-tertiary)",
        boxShadow: checked
          ? "0 0 0 1px var(--color-accent)"
          : "0 0 0 1px var(--color-border-default)",
      }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 transition-all"
        style={{
          left: checked ? 18 : 2,
          backgroundColor: "white",
          borderRadius: "9999px",
        }}
      />
    </button>
  );
}

export default function SettingsPanel() {
  return (
    <div className="p-4 max-w-3xl">
      <div className="mb-6">
        <div
          className="text-xs uppercase tracking-widest mb-1 theme-text-muted"
        >
          Settings
        </div>
        <h1 className="text-xl font-semibold theme-text">
          Workspace preferences
        </h1>
      </div>

      {/* Section: Backend API origin */}
      <BackendApiSection />

      <RpcEndpointSection />

      <TestnetsSection />

      <NotificationsSection />

      <BuildSection />

      {/* Section: Future home for other prefs */}
      <Section title="More" icon="heroicons:adjustments-horizontal">
        <div
          className="text-xs italic py-4 text-center theme-text-muted"
        >
          Network, theme accents, default route, keyboard shortcuts —
          will live here as we add them.
        </div>
      </Section>
    </div>
  );
}

/**
 * Backend API origin override (IPFS-portable frontend, recommendation B).
 *
 * `resolveApiBase()` reads the override once at module load, so a change here
 * only takes effect after a page reload — the UI states that plainly rather
 * than pretending the swap is live-reactive.
 */
function BackendApiSection() {
  const effective = resolveApiBase();
  const [draft, setDraft] = useState(() => getApiBaseOverride() ?? "");
  const [stored, setStored] = useState<string | null>(() => getApiBaseOverride());
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter an http(s) origin, e.g. https://explore.valve.city");
      return;
    }
    const saved = setApiBaseOverride(trimmed);
    if (!saved) {
      setError("Not a valid http(s) origin.");
      return;
    }
    setError(null);
    setStored(saved);
    setDraft(saved);
  };

  const clear = () => {
    clearApiBaseOverride();
    setStored(null);
    setDraft("");
    setError(null);
  };

  return (
    <Section title="Backend API origin" icon="heroicons:server-stack">
      <div className="space-y-stack pt-2">
        <div className="flex items-center justify-between gap-row">
          <span className="text-xs uppercase tracking-widest theme-text-muted">
            Currently using
          </span>
          <code className="text-xs theme-mono theme-text">
            {effective || "(same origin)"}
          </code>
        </div>

        <p className="text-xs theme-text-muted max-w-md">
          Override the backend this UI talks to. Needed when the app is served
          from an IPFS gateway and must point at a chosen backend. Only http(s)
          origins are accepted; the value is stored in this browser only.
        </p>

        <div className="flex items-center gap-row">
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
            placeholder="https://explore.valve.city"
            className={`w-full px-2 py-1.5 text-sm theme-mono theme-input-bg theme-text ${
              error ? "bs-b-danger" : "bs-in-muted"
            }`}
          />
          <button
            type="button"
            onClick={apply}
            className="px-4 py-2 text-sm font-medium theme-accent-solid text-white hover:opacity-90 shrink-0"
          >
            Set
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={stored === null}
            className={`px-4 py-2 text-sm font-medium shrink-0 ${
              stored === null
                ? "theme-tertiary-bg theme-text-muted cursor-not-allowed"
                : "theme-secondary-bg theme-text hover:opacity-90"
            }`}
          >
            Clear
          </button>
        </div>

        {error && (
          <div className="text-xs theme-danger">{error}</div>
        )}

        <div className="flex items-start gap-inline text-xs theme-text-muted">
          <Icon
            icon="heroicons:arrow-path"
            className="w-3.5 h-3.5 mt-0.5 shrink-0"
          />
          <span>
            {stored
              ? `Override set to ${stored}. `
              : "No override set. "}
            Reload the page for the change to take effect — the backend origin is
            resolved once when the app loads.
          </span>
        </div>
      </div>
    </Section>
  );
}

function RpcEndpointSection() {
  return (
    <Section title="Chain RPC endpoints" icon="heroicons:bolt">
      <div className="space-y-stack pt-2">
        <p className="text-xs theme-text-muted max-w-md">
          Where this browser sends its own chain calls. Explore&apos;s enriched
          reads (charts, debugger traces, source, decompile) always go through
          our backend and never appear here. What this sets is the raw reads —
          a transaction, an address&apos;s balance and code, a block — plus
          anything your connected wallet needs.
        </p>
        <p className="text-xs theme-text-muted max-w-md">
          The default is Valve&apos;s own public node, which answers for
          historical state — we check that by asking each endpoint for state at
          block 1. Valve states it keeps no request logs and no client IP
          addresses; so does every alternative listed below. Those are the
          providers&apos; own claims, from the chainlist dataset, and we have
          not measured any of them — including ours. Point a chain at your own
          node to depend on nobody. Any endpoint you set must allow browser
          requests (CORS).
        </p>
        {CHAINS.map((chain) => (
          <RpcChainRow key={chain.id} chainId={chain.id} name={chain.name} />
        ))}
        <div className="flex items-start gap-inline text-xs theme-text-muted">
          <Icon
            icon="heroicons:arrow-path"
            className="w-3.5 h-3.5 mt-0.5 shrink-0"
          />
          <span>
            Reload after changing an endpoint. Explorer reads pick up a new
            URL on the next fetch, but your connected wallet&apos;s transport is
            built once when the app loads, so only a reload moves that.
          </span>
        </div>
      </div>
    </Section>
  );
}

/**
 * Show/hide testnets across every chain-less page. This is a cost control,
 * not just a display setting — with testnets off, a chain-less page probes
 * two chains instead of four. See `lib/settings/testnets.ts`.
 */
function TestnetsSection() {
  return (
    <Section title="Testnets" icon="heroicons:beaker">
      <Row
        label="Show testnets"
        hint="Include PulseChain Testnet v4 and Sepolia in chain-less pages, such as the multichain address view. Hiding them halves the number of chains those pages probe."
        control={<TestnetToggle />}
      />
    </Section>
  );
}

/**
 * Desktop notifications for the client-side watcher. Two gates the copy keeps
 * visible: the user PREFERENCE (this toggle) and the browser PERMISSION (only
 * the platform can grant it). Enabling the toggle requests permission if it
 * hasn't been decided; a denied permission can't be re-prompted from script, so
 * we surface that dead-end honestly instead of letting the toggle lie.
 */
function NotificationsSection() {
  const supported = notificationsSupported();
  const [permission, setPermission] = useState<NotifyPermission>(() =>
    notificationPermission(),
  );
  const [enabled, setEnabled] = useState(() => isDesktopNotifyEnabled());

  const persist = (next: boolean) => {
    setEnabled(next);
    setDesktopNotifyEnabled(next);
  };

  const onToggle = (next: boolean) => {
    if (!next) {
      persist(false);
      return;
    }
    // Turning on: ensure permission first, then honor the result.
    if (permission === "granted") {
      persist(true);
      return;
    }
    void requestNotificationPermission().then((result) => {
      setPermission(result);
      persist(result === "granted");
    });
  };

  const denied = permission === "denied";
  const stateLabel = !supported
    ? "Not supported in this browser"
    : permission === "granted"
      ? "Permission granted"
      : permission === "denied"
        ? "Blocked — allow notifications for this site in your browser"
        : "Permission not yet requested";

  return (
    <Section title="Notifications" icon="heroicons:bell-alert">
      <Row
        label="Desktop notifications for watches"
        hint="When a watch fires, also raise an OS-level notification — so a backgrounded tab still alerts you. The in-app toast shows regardless; this is the opt-in escalation, and it runs entirely client-side."
        control={
          <Toggle
            checked={enabled && permission === "granted"}
            onChange={
              supported && !denied ? onToggle : () => {}
            }
          />
        }
      />
      <div className="flex items-start gap-inline text-xs pt-1 theme-text-muted">
        <Icon
          icon={
            permission === "granted"
              ? "heroicons:check-circle"
              : "heroicons:information-circle"
          }
          className="w-3.5 h-3.5 mt-0.5 shrink-0"
        />
        <span>{stateLabel}.</span>
      </div>
    </Section>
  );
}

/**
 * Which commit this bundle is. Baked at build time (see lib/buildInfo), so it
 * answers "what am I running?" even on the IPFS build, which has no /health.
 */
function BuildSection() {
  const commitDate =
    BUILD_INFO.commitISO === null
      ? "unknown"
      : new Date(BUILD_INFO.commitISO).toLocaleString();

  return (
    <Section title="Build" icon="heroicons:cube">
      <Row
        label="Commit"
        hint={`Branch ${BUILD_INFO.branch} — committed ${commitDate}`}
        control={
          <code className="text-xs font-mono theme-text-muted">
            {BUILD_INFO.shortSha}
          </code>
        }
      />
      <Row
        label="Built"
        hint="When this bundle was compiled."
        control={
          <code className="text-xs font-mono theme-text-muted">
            {new Date(BUILD_INFO.builtAtISO).toLocaleString()}
          </code>
        }
      />
    </Section>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 card p-5">
      <div
        className="flex items-center gap-inline mb-4 text-xs uppercase tracking-widest theme-text-muted"
      >
        <Icon icon={icon} className="w-3.5 h-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm theme-text">
          {label}
        </div>
        <div className="text-xs mt-0.5 max-w-md theme-text-muted">
          {hint}
        </div>
      </div>
      {control}
    </div>
  );
}
