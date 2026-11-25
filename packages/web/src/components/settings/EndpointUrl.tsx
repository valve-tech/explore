import { Tooltip } from "../primitives/Tooltip";

/** The tail that stays on screen when the middle of a URL is cut. */
const TAIL_CHARS = 14;

/**
 * An endpoint URL that never clips silently.
 *
 * On a phone the full URL wraps. From `sm` up it stays on one line. When
 * the line is too short, the middle is cut and the tail stays. The full URL
 * is in the DOM and in the tooltip.
 */
export function EndpointUrl({ url }: { url: string }) {
  const cut = Math.max(0, url.length - TAIL_CHARS);
  return (
    <Tooltip label={url} wrap side="bottom" className="min-w-0 max-w-full">
      <code className="min-w-0 text-xs theme-mono theme-text break-all sm:flex sm:break-normal">
        <span className="sm:min-w-0 sm:truncate">{url.slice(0, cut)}</span>
        <span className="sm:shrink-0 sm:whitespace-nowrap">{url.slice(cut)}</span>
      </code>
    </Tooltip>
  );
}
