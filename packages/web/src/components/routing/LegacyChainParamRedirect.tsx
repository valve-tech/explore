import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { chainRoutePrefix, parseChainScope } from "../../lib/chainScope";

/**
 * One-time rewrite of the legacy `?chainid=N` form into the path form.
 *
 * Fires only when the path has NO chain prefix. That condition is what makes a
 * loop impossible: the rewrite writes a prefix, and a prefixed path never
 * re-enters this branch. It mirrors the same rule in `useResolvedChainRedirect`
 * — writing the scope is what disables the thing that writes it.
 *
 * An unregistered chainid is left alone. `chainRoutePrefix` returns "" for it,
 * and rewriting to a bare path would silently change which chain the page is
 * about.
 */
export default function LegacyChainParamRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const hasParam = params.has("chainid");
  // parseChainScope prefers the path, so a prefixed path yields the path's id.
  // Compare against the raw parameter to detect "prefix already present".
  const prefixed = parseChainScope(location.pathname, "").kind === "one";
  const raw = params.get("chainid");
  const chainId = raw !== null && Number.isInteger(Number(raw)) ? Number(raw) : NaN;
  const prefix = Number.isNaN(chainId) ? "" : chainRoutePrefix(chainId);
  const shouldRewrite = hasParam && !prefixed && prefix !== "";

  useEffect(() => {
    if (!shouldRewrite) return;
    const next = new URLSearchParams(location.search);
    next.delete("chainid");
    const query = next.toString();
    navigate(`${prefix}${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
  }, [shouldRewrite, prefix, location.pathname, location.search, navigate]);

  return null;
}
