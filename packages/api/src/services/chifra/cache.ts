/**
 * In-memory TTL cache for normalized chifra responses. Mirrors the
 * decoder/abiCache pattern: 1h TTL, 500-entry FIFO cap, exported
 * invalidator.
 *
 * Why a separate cache from abiCache: chifra responses are far larger than
 * ABIs (megabytes vs kilobytes) and have a different invalidation logic
 * (new blocks make the cache stale; ABIs only invalidate on re-verification).
 */

const CHIFRA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CHIFRA_CACHE_MAX_ENTRIES = 500;

interface CacheEntry<T> {
  value: T;
  t: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** `ttlMs` lets a caller keep a shorter life than the 1h default. */
export function readCache<T>(key: string, ttlMs: number = CHIFRA_CACHE_TTL_MS): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeCache<T>(key: string, value: T): void {
  cache.set(key, { value, t: Date.now() });
  if (cache.size > CHIFRA_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function invalidateChifraCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Test helper. */
export function _getChifraCacheSize(): number {
  return cache.size;
}
