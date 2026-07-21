/**
 * /ui — in-app component gallery. Renders primitives and feature components in
 * their variations, each tagged with a stable ID. Reference a variation by its
 * ID (e.g. "tweak badge/warn" or "show another gas-row variation") instead of
 * describing it. New/experimental variations can be parked here side-by-side.
 *
 * This is a living design surface, not production UI — it's reached from the
 * sidebar footer, not the main nav.
 */

import { useState } from "react";
import { Badge } from "../primitives/Badge";
import { CopyButton } from "../primitives/CopyButton";
import { Tooltip } from "../primitives/Tooltip";
import { EmptyState } from "../primitives/EmptyState";
import { Checkbox } from "../primitives/Checkbox";
import { Dropdown } from "../primitives/Dropdown";
import { StatusBadge } from "../primitives/StatusBadge";
import { EntityActionBar } from "../EntityActionBar";
import { RecentRail } from "../RecentRail";
import { GasOracleWidget } from "../explorer/GasOracleWidget";
import { NoTrackedTxs } from "../mempool/TrackedTxPanel";

const SAMPLE_TX =
  "0xab12cd34ef5678901234567890abcdef1234567890abcdef1234567890abcd9f";
const SAMPLE_ADDR = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

export default function ComponentGallery() {
  return (
    <div className="max-w-5xl mx-auto space-y-section py-2">
      <header className="space-y-tight">
        <h1
          className="text-2xl font-semibold theme-text"
        >
          Component gallery
        </h1>
        <p className="text-sm max-w-2xl theme-text-secondary">
          Every component and variation below carries a stable{" "}
          <span className="font-mono theme-accent">
            ID
          </span>{" "}
          (click it to copy). Reference an ID to ask for a change — e.g.
          &ldquo;make <span className="font-mono">badge/warn</span> louder&rdquo;
          — instead of describing the component. Ask for new variations and
          they&rsquo;ll be parked here next to the originals.
        </p>
      </header>

      <GallerySection title="Primitives">
        <GalleryItem id="badge" title="Badge — semantic pill">
          <Variant id="badge/ok"><Badge variant="ok">Success</Badge></Variant>
          <Variant id="badge/bad"><Badge variant="bad">Reverted</Badge></Variant>
          <Variant id="badge/warn"><Badge variant="warn">Pending</Badge></Variant>
          <Variant id="badge/info"><Badge variant="info">EIP-1559</Badge></Variant>
          <Variant id="badge/neutral"><Badge variant="neutral">Legacy</Badge></Variant>
        </GalleryItem>

        <GalleryItem id="status-badge" title="StatusBadge — success/reverted with dot">
          <Variant id="status-badge/success"><StatusBadge success /></Variant>
          <Variant id="status-badge/reverted"><StatusBadge success={false} /></Variant>
          <Variant id="status-badge/lg"><StatusBadge success size="lg" /></Variant>
        </GalleryItem>

        <GalleryItem id="copy-button" title="CopyButton — clipboard + ✓ feedback">
          <Variant id="copy-button/default">
            <span className="flex items-center gap-tight font-mono text-xs theme-text-secondary">
              {SAMPLE_ADDR.slice(0, 10)}…
              <CopyButton value={SAMPLE_ADDR} />
            </span>
          </Variant>
        </GalleryItem>

        <GalleryItem id="tooltip" title="Tooltip — hover/focus label">
          <Variant id="tooltip/default">
            <Tooltip label="Themed, positioned, dismiss-on-leave">
              <span
                className="text-xs px-2 py-1 font-mono theme-tertiary-bg theme-text-secondary"
              >
                hover me
              </span>
            </Tooltip>
          </Variant>
        </GalleryItem>

        <GalleryItem id="checkbox" title="Checkbox — themed (non-native)">
          <Variant id="checkbox/interactive"><DemoCheckbox /></Variant>
        </GalleryItem>

        <GalleryItem id="dropdown" title="Dropdown — menu replacing native select">
          <Variant id="dropdown/default"><DemoDropdown /></Variant>
        </GalleryItem>

        <GalleryItem id="empty-state" title="EmptyState — zero/empty surface">
          <Variant id="empty-state/default">
            <div className="card w-full max-w-md">
              <EmptyState
                icon="heroicons:inbox"
                title="No pending transactions"
                subtitle="The mempool is clear right now."
              />
            </div>
          </Variant>
        </GalleryItem>
      </GallerySection>

      <GallerySection title="Composite components">
        <GalleryItem id="entity-bar" title="EntityActionBar — cross-feature jumps">
          <Variant id="entity-bar/labeled-tx">
            <EntityActionBar kind="tx" value={SAMPLE_TX} contractAddress={SAMPLE_ADDR} />
          </Variant>
          <Variant id="entity-bar/labeled-address">
            <EntityActionBar kind="address" value={SAMPLE_ADDR} omit={["explorer"]} />
          </Variant>
          <Variant id="entity-bar/compact-tx">
            <EntityActionBar kind="tx" value={SAMPLE_TX} variant="compact" />
          </Variant>
        </GalleryItem>

        <GalleryItem id="gas-row" title="GasOracleWidget — thin gas row (live data)">
          <Variant id="gas-row/default" full>
            <GasOracleWidget />
          </Variant>
        </GalleryItem>

        <GalleryItem id="recent-rail" title="RecentRail — recent & pinned entities (live)">
          <Variant id="recent-rail/default">
            <div className="w-full max-w-[300px]">
              <RecentRail />
            </div>
          </Variant>
        </GalleryItem>

        <GalleryItem id="tracked-empty" title="Tracked transactions — empty state">
          <Variant id="tracked-empty/default">
            <div className="card w-full max-w-md">
              <NoTrackedTxs />
            </div>
          </Variant>
        </GalleryItem>
      </GallerySection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gallery framework                                                  */
/* ------------------------------------------------------------------ */

function GallerySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-row">
      <h2
        className="text-sm font-semibold uppercase tracking-widest theme-text"
      >
        {title}
      </h2>
      <div className="space-y-row">{children}</div>
    </section>
  );
}

function GalleryItem({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-2 sm:p-4">
      <div className="flex items-center gap-row mb-3">
        <IdChip id={id} />
        <span className="text-sm font-medium theme-text">
          {title}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-row">{children}</div>
    </div>
  );
}

function Variant({
  id,
  full = false,
  children,
}: {
  id: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-tight ${full ? "w-full" : ""}`}>
      <IdChip id={id} small />
      <div
        className={`flex items-center p-3 bs-in-muted ${full ? "w-full" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}

function IdChip({ id, small = false }: { id: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-tight font-mono theme-accent theme-accent-bg ${small ? "text-[10px]" : "text-[11px]"}`}
      style={{ padding: "1px 6px" }}
    >
      {id}
      <CopyButton value={id} title={`Copy "${id}"`} size={16} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Stateful demo wrappers                                             */
/* ------------------------------------------------------------------ */

function DemoCheckbox() {
  const [on, setOn] = useState(true);
  return <Checkbox checked={on} onChange={setOn} label="Auto-fetch ABI" />;
}

function DemoDropdown() {
  const [v, setV] = useState<"tip" | "nonce" | "cap">("tip");
  return (
    <Dropdown<"tip" | "nonce" | "cap">
      value={v}
      onChange={setV}
      ariaLabel="Sort"
      options={[
        { value: "tip", label: "priority tip ↓" },
        { value: "nonce", label: "nonce ↑" },
        { value: "cap", label: "fee cap ↓" },
      ]}
    />
  );
}
