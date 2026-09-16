# Gateway reset incidents seen from the indexer, Aug-Sep 2026

`one.valve.city` drops every in-flight connection at once, for a few minutes at
a time. This file exists because **valve-prod keeps under 8 hours of journal**
(2 GB cap, ~400 MB written every 90 minutes), so their side of these windows is
already gone. The indexer's Caddy container held a month, and this is the
distilled record.

The signature: resets sharing a timestamp **to the second** across unrelated
containers and unrelated chains. When the explorer looks broken on every chain
at once, look for this before looking at our code.

Source: `valve-rpc-proxy` container log, scrubbed of the RPC key. Full scrubbed
archive on the indexer at `/root/caddy-rpc-proxy-archive-20260916.log.gz`, and
locally at `valve-tech/probes/caddy-window-20260916.log`. Client cancellations
(1,365 of 1,433 lines, mostly chifra cancelling its own parallel requests) are
excluded — they are not faults.

## The incidents

| Window (UTC) | Upstream aborts |
|---|---|
| 2026-08-24T18:00Z | 1 |
| 2026-08-26T16:00Z | 1 |
| 2026-09-04T08:00Z | 1 |
| 2026-09-04T17:00Z | 1 |
| 2026-09-04T20:00Z | 1 |
| 2026-09-07T19:00Z | 11 |
| 2026-09-07T21:00Z | 7 |
| 2026-09-08T08:00Z | 9 |
| 2026-09-08T12:00Z | 1 |
| 2026-09-15T12:00Z | 23 |
| 2026-09-15T13:00Z | 7 |
| 2026-09-15T21:00Z | 1 |
| 2026-09-15T22:00Z | 2 |

Total upstream-side aborts: **66** across 13 windows.

## The largest, 2026-09-15

Accompanied by 502s from 12:50:33Z to 13:11:26Z on chains 1, 369 and 11155111.

| Timestamp (UTC) | Client | Chain | Duration | Class |
|---|---|---|---|---|
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.75s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.76s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.77s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.78s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.79s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.8s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.81s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.81s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.81s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.82s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.82s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.83s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.83s | reset |
| 2026-09-15T12:51:26Z | scraper-pls | 369 | 1.88s | reset |
| 2026-09-15T12:51:26Z | scraper-sepolia | 11155111 | 0.34s | reset |
| 2026-09-15T12:51:44Z | appearances | 1 | 0.52s | reset |
| 2026-09-15T12:52:16Z | appearances | 1 | 0.18s | reset |
| 2026-09-15T12:52:16Z | appearances | 1 | 0.25s | reset |
| 2026-09-15T12:52:17Z | appearances | 1 | 0.54s | reset |
| 2026-09-15T12:52:17Z | appearances | 1 | 0.54s | reset |
| 2026-09-15T12:59:53Z | appearances | 1 | 0.67s | reset |
| 2026-09-15T12:59:56Z | appearances | 1 | 0.55s | reset |
| 2026-09-15T12:59:56Z | appearances | 1 | 1.12s | reset |
| 2026-09-15T13:05:17Z | appearances | 1 | 1.03s | reset |
| 2026-09-15T13:05:18Z | appearances | 1 | 0.73s | reset |
| 2026-09-15T13:05:19Z | appearances | 1 | 0.47s | reset |
| 2026-09-15T13:05:19Z | appearances | 1 | 0.68s | reset |
| 2026-09-15T13:05:19Z | scraper-sepolia | 11155111 | 0.31s | reset |
| 2026-09-15T13:05:20Z | scraper-sepolia | 11155111 | 0.37s | reset |
| 2026-09-15T13:05:21Z | appearances | 1 | 1.44s | reset |
| 2026-09-15T21:13:08Z | appearances | 1 | 0.75s | EOF |
| 2026-09-15T22:33:24Z | appearances | 1 | 1.06s | reset |
| 2026-09-15T22:33:27Z | scraper-sepolia | 11155111 | 0.22s | reset |
