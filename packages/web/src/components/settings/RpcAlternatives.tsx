import { useEffect, useState } from "react";
import { probeArchive, VERDICT_LABEL, type ArchiveVerdict } from "../../lib/rpcArchive";
import type { RpcChoice } from "../../lib/rpcSuggestions";

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
    <div className="space-y-stack">
      <div className="flex flex-wrap items-center gap-inline text-xs">
        <span className="theme-text-muted uppercase tracking-wide shrink-0">
          No-log options
        </span>
        {choices.map((choice) => {
          const active = effective === choice.url;
          const verdict = verdicts[choice.url];
          const dead = verdict != null && verdict !== "archive";
          return (
            <button
              key={choice.url}
              type="button"
              onClick={() => onPick(choice.url)}
              title={
                `${choice.url} — provider states it keeps no logs` +
                (choice.isValve ? ". Valve's own node." : "") +
                (verdict ? `. Tested: ${VERDICT_LABEL[verdict]}.` : "")
              }
              /*
               * `break-all`, not `shrink-0`. A tested chip carries its host
               * AND its verdict — "eth-sepolia-testnet.api.pocket.network ·
               * recent blocks only" measures 425px against a 365px content
               * pane at 375px wide. Held rigid it pushed the pane sideways,
               * which the probe e2e caught and a pre-probe measurement could
               * not. The host is the chip's identity, so it wraps rather than
               * truncating.
               */
              className={`px-1.5 py-0.5 theme-mono text-left break-all shadow-[0_0_0_1px_var(--color-border-default)] ${
                dead ? "line-through opacity-50 " : ""
              }${
                active
                  ? "theme-accent-solid text-white"
                  : "theme-text-muted hover:theme-text"
              }`}
            >
              {choice.isValve ? "Valve" : hostOf(choice.url)}
              {verdict && verdict !== "archive" && (
                <span className="ml-1 normal-case">· {VERDICT_LABEL[verdict]}</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="px-1.5 py-0.5 shrink-0 theme-secondary-bg theme-text shadow-[0_0_0_1px_var(--color-border-default)] hover:opacity-90 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test"}
        </button>
      </div>

      <p className="text-xs theme-text-muted">
        {tested
          ? `${usable} of ${choices.length} can read state at block 1. The rest answer for recent blocks only, or not at all — this app reads history, so they will fail here.`
          : "Each provider states it keeps no logs; that is their claim, not our measurement. Whether one serves history is ours — press Test to find out."}
      </p>
    </div>
  );
}
