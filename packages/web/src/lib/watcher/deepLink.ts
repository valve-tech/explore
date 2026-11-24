/**
 * Where clicking a fired watch should take you.
 *
 * A pure map from a `WatchMatch` to an in-app route path. Kept free of any
 * router/DOM concern so it's trivially unit-testable and so the same policy can
 * back both the desktop-notification click and (later) any other "open this
 * match" affordance. The caller hands the returned path to react-router's
 * `navigate`, which writes it into the hash (`/#/tx/…`) — so this helper returns
 * a plain path and stays oblivious to the router.
 *
 * Returns a path string, never null: every match should lead somewhere useful.
 */

import type { WatchMatch } from "./types.js";

export function deepLinkForMatch(match: WatchMatch): string {
  // A mined match points at its tx — the canonical Explore route, same as the
  // workspace activity rows. A pending erc20_transfer log can lack a hash; fall
  // back to the workspace that owns the rule, where its activity log lives. No
  // `?chainid=` param yet — the multichain routing isn't wired, so a plain path
  // matches every other deep-link in the app.
  if (match.txHash) return `/tx/${match.txHash}`;
  return `/workspace/${match.workspaceId}`;
}
