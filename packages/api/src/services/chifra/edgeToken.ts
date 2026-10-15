/**
 * The chifra edge on direct-a-evm-1 (config/caddy/a1-indexer.conf in the
 * monorepo) refuses /export and /status without the header
 * X-Valve-Chifra-Token. Every chifra call sends it when CHIFRA_TOKEN is set:
 * one rule for every route, so a new SDK call cannot forget it. With no
 * CHIFRA_TOKEN the request is unchanged.
 */
export const CHIFRA_TOKEN_HEADER = "X-Valve-Chifra-Token";

export function withChifraToken(
  init: RequestInit | undefined,
  token: string | undefined = process.env.CHIFRA_TOKEN,
): RequestInit {
  if (!token) return { ...init };
  const headers = new Headers(init?.headers);
  headers.set(CHIFRA_TOKEN_HEADER, token);
  return { ...init, headers };
}
