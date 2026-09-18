-- Scrub credentials out of already-stored action execution logs.
--
-- Before the executor learned to redact (fix ae0634f), a user action that
-- triggered a viem transport error captured the full request URL — RPC key and
-- all — into its stdout/stderr, and those rows were stored here and served back
-- to the action's owner. New rows are clean; this backfills the old ones.
--
-- The replacement mirrors `packages/api/src/lib/redactSecrets`, in the same
-- order (userinfo, then the vk_ token, then bearer, then the URL path/query
-- collapse), so a row scrubbed here reads exactly as one the live code would
-- produce. regexp_replace is idempotent for these patterns — `vk_***` no longer
-- matches `vk_[...]+` — so re-running the migration is safe.
--
-- Only rows that still contain a credential shape are rewritten, to keep the
-- backfill cheap on a large action_logs table.

UPDATE action_logs
SET
  stdout = regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(stdout, '://[^/@[:space:]]+@', '://***@', 'g'),
                 'vk_[A-Za-z0-9_-]+', 'vk_***', 'g'),
               '(bearer[[:space:]]+)[A-Za-z0-9._~+/=-]{8,}', '\1***', 'gi'),
             '(https?://[^/[:space:]"'']+)(/[^[:space:]"'']*)', '\1/***', 'g'),
  stderr = regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(stderr, '://[^/@[:space:]]+@', '://***@', 'g'),
                 'vk_[A-Za-z0-9_-]+', 'vk_***', 'g'),
               '(bearer[[:space:]]+)[A-Za-z0-9._~+/=-]{8,}', '\1***', 'gi'),
             '(https?://[^/[:space:]"'']+)(/[^[:space:]"'']*)', '\1/***', 'g')
WHERE stdout ~ 'vk_[A-Za-z0-9_-]+|https?://|bearer[[:space:]]'
   OR stderr ~ 'vk_[A-Za-z0-9_-]+|https?://|bearer[[:space:]]';
