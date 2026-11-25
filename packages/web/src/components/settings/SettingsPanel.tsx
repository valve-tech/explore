import { useState } from "react";
import { Icon } from "@iconify/react";
import {
  resolveApiBase,
  getApiBaseOverride,
  setApiBaseOverride,
  clearApiBaseOverride,
} from "../../lib/apiBase";
import { RpcChainRow } from "./RpcChainRow";
import { OverrideField } from "./OverrideField";
import { InfoButton, FactList } from "./InfoDisclosure";
import { BACKEND_FACTS, RPC_FACTS } from "./rpcFacts";
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
import TimeDisplayPicker from "./TimeDisplayPicker";

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
    // The cards pad. This wrapper only spaces them and adds no padding.
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-stack">
      <div className="lg:col-span-2">
        <div className="text-xs uppercase tracking-widest mb-1 theme-text-muted">
          Settings
        </div>
        <h1 className="text-xl font-semibold theme-text">
          Workspace preferences
        </h1>
      </div>

      <BackendApiSection />
      <RpcEndpointSection />
      <TestnetsSection />
      <TimeDisplaySection />
      <NotificationsSection />
      <BuildSection />

      {/* Section: Future home for other prefs */}
      <Section
        title="More"
        icon="heroicons:adjustments-horizontal"
        className="lg:col-span-2"
      >
        <div className="text-xs italic text-center theme-text-muted">
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
    <Section
      title="Backend API origin"
      icon="heroicons:server-stack"
      facts={BACKEND_FACTS}
      className="lg:col-span-2"
    >
      <div className="flex flex-col gap-inline max-w-2xl">
        <div className="flex flex-wrap items-baseline gap-x-inline gap-y-tight text-xs">
          <span className="uppercase tracking-wide theme-text-muted">
            Currently using
          </span>
          <code className="theme-mono theme-text break-all">
            {effective || "(same origin)"}
          </code>
        </div>

        <OverrideField
          draft={draft}
          onDraft={(value) => {
            setDraft(value);
            if (error) setError(null);
          }}
          onApply={apply}
          onClear={clear}
          canClear={stored !== null}
          error={error}
          placeholder="https://explore.valve.city"
        />

        <div className="text-xs theme-text-muted break-all">
          {stored ? `Override set to ${stored}. ` : "No override set. "}
          Reload to apply.
        </div>
      </div>
    </Section>
  );
}

function RpcEndpointSection() {
  return (
    <Section
      title="Chain RPC endpoints"
      icon="heroicons:bolt"
      facts={RPC_FACTS}
      className="lg:col-span-2"
    >
      {/* The grid spaces the chains. They carry no padding of their own. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-section">
        {CHAINS.map((chain) => (
          <RpcChainRow key={chain.id} chainId={chain.id} name={chain.name} />
        ))}
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
 * How chain timestamps render in every table: an age, a UTC date, or both.
 * See `lib/settings/timeDisplay.ts`.
 */
function TimeDisplaySection() {
  return (
    <Section title="Time" icon="heroicons:clock">
      <Row
        label="Timestamps"
        hint="How tables show when something happened. The other form stays in the tooltip."
        control={<TimeDisplayPicker />}
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
  facts,
  className = "",
  children,
}: {
  title: string;
  icon: string;
  /** Detail the section keeps behind its info button. */
  facts?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const [showFacts, setShowFacts] = useState(false);
  return (
    <div className={`card p-2 sm:p-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-inline mb-3 min-h-6">
        <div className="flex items-center gap-inline text-xs uppercase tracking-widest theme-text-muted">
          <Icon icon={icon} className="w-3.5 h-3.5" />
          {title}
        </div>
        {facts && (
          <InfoButton open={showFacts} onToggle={() => setShowFacts((s) => !s)} />
        )}
      </div>
      {facts && showFacts && (
        <div className="mb-3">
          <FactList facts={facts} />
        </div>
      )}
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
