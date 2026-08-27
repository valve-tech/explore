/**
 * Strip credentials out of anything on its way to a client or a log.
 *
 * Our RPC keys live in the URL **path** (`https://host/rpc/vk_…/evm/1`), and
 * viem puts the full request URL in the message of every transport error. So
 * an upstream failure carried the private key into `{"ok":false,"error":…}`
 * and out to the public internet. Found live on 2026-08-27: every chain's
 * `/api/block/:n` 500 handed out a 35-character `vk_` key to any caller.
 *
 * The rule this enforces is the standing one — a secret that reaches a log, a
 * response body, a journal or a screenshot is a leak, whatever put it there.
 * Redaction happens at the boundary rather than at each call site, because
 * there are hundreds of call sites and one boundary.
 */

/** Keys the valve gateway issues: `vk_` then an opaque token. */
const VK_KEY = /vk_[A-Za-z0-9_-]+/g;

/** `Authorization: Bearer <token>`, in whatever prose an error wraps it. */
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/** `scheme://user:pass@host` — the credential is the `user:pass` part. */
const USERINFO = /:\/\/[^/@\s]+@/g;

/**
 * An absolute http(s) URL. The path and query are collapsed because that is
 * where our keys live and a client never needs an upstream's path to act on
 * an error. The host survives, which is what makes a message still diagnosable.
 */
const URL_PATH = /(https?:\/\/[^/\s"']+)(\/[^\s"']*)/g;

/**
 * Redact every credential shape we know how to recognise.
 *
 * Order matters: userinfo first (it sits between the scheme and the host, so
 * collapsing paths would otherwise leave it in place), then the token shapes,
 * then the path collapse that catches anything key-like we did not name.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(USERINFO, "://***@")
    .replace(VK_KEY, "vk_***")
    .replace(BEARER, "$1***")
    .replace(URL_PATH, "$1/***");
}

/**
 * True when a string still carries something that looks like a credential.
 *
 * Used by the tests as a backstop rather than by the code: it asserts the
 * OUTPUT of `redactSecrets` is clean, so a new secret shape that slips past
 * the patterns above fails a test instead of reaching a client.
 */
export function looksLikeSecret(text: string): boolean {
  return (
    // `vk_***` is the redacted form, so require something beyond asterisks.
    /vk_(?!\*)[A-Za-z0-9_-]{4,}/.test(text) ||
    /\bbearer\s+(?!\*)[A-Za-z0-9._~+/=-]{8,}/i.test(text) ||
    /:\/\/(?!\*\*\*@)[^/@\s]+@/.test(text)
  );
}
