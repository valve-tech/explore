-- Chain-scope the tx-hash-keyed trace cache.
--
-- Migration 009 chain-scoped the address-keyed caches (verified_sources,
-- slither_results) but missed trace_cache — the only tx-hash-keyed one. Its
-- unique key was (tx_hash, trace_type) with no chain, so ONE chain's trace was
-- served to EVERY chain: a chain-943 transaction's call tree rendered on a
-- `?chainid=369` request, while the gas/opcode fetches for that same request
-- went live to 369 and correctly reported "transaction not found". The debugger
-- then half-rendered wrong-chain data next to errors.
--
-- Existing rows are DELETED rather than backfilled to 369. That is the
-- difference from 009: there, every pre-multichain row genuinely was PulseChain,
-- so `DEFAULT 369` was exact. Here the rows were written *after* `?chainid=N`
-- routing landed, mixing traces from chains 1/369/943 with nothing in the row to
-- tell them apart — a 369 backfill would stamp the very mislabeling this
-- migration exists to remove. trace_cache is a pure derived cache of immutable
-- debug_traceTransaction output, so every dropped row is re-fetched on next
-- request; the cost is one cold trace per transaction, not lost data.
DELETE FROM trace_cache;

ALTER TABLE trace_cache
  ADD COLUMN IF NOT EXISTS chain_id INTEGER NOT NULL;

DROP INDEX IF EXISTS idx_trace_cache_hash_type;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_cache_chain_hash_type
  ON trace_cache(chain_id, tx_hash, trace_type);
