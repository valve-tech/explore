/**
 * Recent & Pinned entity rail. Reads the shared recent-entities store and lets
 * the user jump back to anything they've looked at, or pin the ones they keep
 * returning to. Navigates via the hash router so it works from the app shell,
 * outside any single feature's navigation context.
 */

import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useRecentEntities } from "../hooks/useRecentEntities";
import { togglePin, type RecentEntity } from "../lib/recentEntities";
import {
  dotColor,
  hrefFor,
  primaryLabel,
  secondaryLabel,
} from "../lib/recentEntityView";
import { EmptyState } from "./primitives/EmptyState";
import { Tooltip } from "./primitives/Tooltip";

export function RecentRail() {
  const entities = useRecentEntities();
  const pinned = entities.filter((e) => e.pinned);
  const recent = entities.filter((e) => !e.pinned);

  return (
    <div className="card w-full">
      <div className="bs-b-muted flex items-center justify-between px-3 py-2">
        <h3
          className="text-[11px] font-semibold uppercase tracking-widest theme-text-secondary"
        >
          Recent &amp; Pinned
        </h3>
        {entities.length > 0 && (
          <span
            className="text-[11px] font-mono theme-text-muted"
          >
            {entities.length}
          </span>
        )}
      </div>

      {entities.length === 0 ? (
        <EmptyState
          icon="heroicons:clock"
          title="Nothing viewed yet"
          subtitle="Transactions, addresses and blocks you open will show up here."
        />
      ) : (
        <div>
          {pinned.length > 0 && <GroupLabel>★ Pinned</GroupLabel>}
          {pinned.map((e) => (
            <Row key={`${e.kind}:${e.value}`} entity={e} />
          ))}
          {recent.length > 0 && <GroupLabel>Recent</GroupLabel>}
          {recent.map((e) => (
            <Row key={`${e.kind}:${e.value}`} entity={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[9px] uppercase tracking-widest px-3 pt-2 pb-1 theme-text-muted"
    >
      {children}
    </div>
  );
}

function Row({ entity }: { entity: RecentEntity }) {
  const navigate = useNavigate();
  const go = () => {
    navigate(hrefFor(entity));
  };

  return (
    <div
      className="group bs-b-muted flex items-center gap-inline px-3 py-2 cursor-pointer hover:opacity-90 transition-opacity"
      onClick={go}
      style={{ backgroundColor: "transparent" }}
    >
      <span
        className="shrink-0 w-1.5 h-1.5"
        style={{ backgroundColor: dotColor(entity) }}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-xs font-mono truncate theme-accent"
        >
          {primaryLabel(entity)}
        </div>
        <div className="text-[10px] mt-0.5 theme-text-muted">
          {secondaryLabel(entity)}
        </div>
      </div>
      <Tooltip className="shrink-0" label={entity.pinned ? "Unpin" : "Pin"}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePin(entity.kind, entity.value);
          }}
          aria-label={entity.pinned ? "Unpin" : "Pin"}
          className={`shrink-0 transition-opacity ${
            entity.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{
            color: entity.pinned
              ? "var(--color-warning)"
              : "var(--color-text-muted)",
            backgroundColor: "transparent",
          }}
        >
          <Icon
            icon={entity.pinned ? "heroicons:star-solid" : "heroicons:star"}
            className="w-3.5 h-3.5"
          />
        </button>
      </Tooltip>
    </div>
  );
}
