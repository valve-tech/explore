/**
 * Both builds mount a HashRouter, so the route lives in the URL hash
 * (`/#/eip155/1/tx/0xabc`). An EIP-3091 tool builds a path URL instead
 * (`/eip155/1/tx/0xabc`, `/tx/0xabc`). The server serves the app at any
 * path, and main.tsx moves the path into the hash before the router mounts.
 *
 * Returns the URL to `replaceState` to, or null when there is nothing to move:
 * - the hash already holds a route (`#/…`), so it wins and the path is dropped;
 * - the path is `/` and there is no query.
 * A query outside the hash moves in with the path, because a HashRouter reads
 * only the query inside the hash (`?chainid=1` included).
 */
export function pathToHashUrl(pathname: string, search: string, hash: string): string | null {
  if (hash.startsWith("#/")) return pathname === "/" && !search ? null : `/${hash}`;
  if (pathname === "/" && !search) return null;
  return `/#${pathname}${search}`;
}
