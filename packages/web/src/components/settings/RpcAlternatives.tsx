import { useEffect, useState } from "react";
import { probeArchive, VERDICT_LABEL, type ArchiveVerdict } from "../../lib/rpcArchive";
import type { RpcChoice } from "../../lib/rpcSuggestions";
import { Tooltip } from "../primitives/Tooltip";

/** Host of a URL, for a compact chip label. Falls back to the raw string. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The endpoints a user can switch to, and what each one can actually do.
 *
 * Two claims are made about these endpoints and only one of them is ours.
 * The provider states it keeps no logs — that is chainlist's record of the
 * provider's own words, and we cannot check it. Whether the endpoint serves
 * history is something we CAN check, so we do, and until we have we say so.
 *
 * The list starts untested on purpose. Probing on mount would open a
 * connection to every third party on the list the moment the settings page
 * rendered, which is the opposite of what someone reading this row wants.
 *
 * Once tested, endpoints that cannot serve history are struck through rather
 * than removed. Removing them would silently shorten the list and leave the
 * user wondering what happened; showing the verdict answers the question
 * they pressed the button to ask.
 *
 * The row shows little. A tooltip on the label, on Test, on the count and on
 * each chip carries the detail.
 */
export function RpcAlternatives({
  choices,
  effective,
  onPick,
}: {
  choices: RpcChoice[];
  /** The endpoint in force, so the matching chip can render as active. */
  effective: string | undefined;
  onPick: (url: string) => void;
}) {
  const [verdicts, setVerdicts] = useState<Record<string, ArchiveVerdict>>({});
  const [testing, setTesting] = useState(false);

  // Drop stale verdicts when the chain changes under us — a verdict is about
  // one endpoint on one chain, and this component is reused per row.
  useEffect(() => {
    setVerdicts({});
  }, [choices]);

  const runTest = async () => {
    setTesting(true);
    const results = await Promise.all(
      choices.map(async (c) => [c.url, (await probeArchive(c.url)).verdict] as const),
    );
    setVerdicts(Object.fromEntries(results));
    setTesting(false);
  };

  if (choices.length === 0) return null;

  const tested = Object.keys(verdicts).length > 0;
  const usable = choices.filter((c) => verdicts[c.url] === "archive").length;

  return (
    <div className="flex flex-col gap-tight min-w-0">
      <div className="flex items-center justify-between gap-inline text-xs">
        <div className="flex flex-wrap items-baseline gap-x-inline min-w-0">
          <Tooltip label="Their claim, not our measurement.">
            <span className="theme-text-muted uppercase tracking-wide">
              No-log options
            </span>
          </Tooltip>
          {tested && (
            <Tooltip
              wrap
              label="The rest answer for recent blocks only, or not at all. This app reads history, so they fail here."
            >
              <span className="theme-text-secondary">
                {usable} of {choices.length} can read state at block 1
              </span>
            </Tooltip>
          )}
        </div>
        <Tooltip label="Asks each endpoint for state at block 1.">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="px-2 py-0.5 shrink-0 theme-secondary-bg theme-text shadow-[0_0_0_1px_var(--color-border-default)] hover:opacity-90 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-tight text-xs">
        {choices.map((choice) => {
          const active = effective === choice.url;
          const verdict = verdicts[choice.url];
          const dead = verdict != null && verdict !== "archive";
          return (
            <Tooltip
              key={choice.url}
              wrap
              className="max-w-full"
              label={
                `${choice.url}. The provider states it keeps no logs.` +
                (choice.isValve ? " Valve's own node." : "") +
                (verdict ? ` Tested: ${VERDICT_LABEL[verdict]}.` : "")
              }
            >
              {/*
               * `break-all`, not `shrink-0`. A tested chip carries its host
               * and its verdict. "eth-sepolia-testnet.api.pocket.network ·
               * recent blocks only" is 425px wide, and the pane is 365px at
               * a 375px viewport. A rigid chip pushed the pane sideways. The
               * host is the chip's identity, so it wraps and never truncates.
               */}
              <button
                type="button"
                onClick={() => onPick(choice.url)}
                className={`px-2 py-0.5 theme-mono text-left break-all shadow-[0_0_0_1px_var(--color-border-default)] ${
                  dead ? "line-through opacity-50 " : ""
                }${
                  active
                    ? "theme-accent-solid text-white"
                    : "theme-text-secondary hover:opacity-80"
                }`}
              >
                {choice.isValve ? "Valve" : hostOf(choice.url)}
                {verdict && verdict !== "archive" && (
                  <span className="ml-1 normal-case">· {VERDICT_LABEL[verdict]}</span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
