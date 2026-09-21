## Summary

`DefaultEmptyResultAccept` exempts the point-state reads with the rationale
"zero value is a real value, not absence" — but the block-scoped **count**
methods, whose zero is a real value in exactly the same way, are not on the
list. So a legitimate `"0x0"` from one of them is classified as empty by
`IsBytesEmptyish` and retried across every upstream on every call, forever, with
no possible benefit because the first upstream already returned the right answer.

The cleanest case is `eth_getUncleCountByBlockNumber` on an ordinary block. After
the merge, every Ethereum block has zero uncles, so the answer is always `"0x0"`
— which means this call pays a full retry sweep *on every mainnet block*, and
returns the same `"0x0"` it started with.

Underneath the specific miss is a design observation: **emptiness is detected by
shape, but exempted by an exact method-name list.** Membership depends on what a
method usually *returns*, so the list cannot be completed by inspection — the
next method that happens to return a legitimate zero is a latent regression.

Verified against `main` at `d45cf9d2` (2026-09-21).

## The specific miss

`common/defaults.go`, `DefaultEmptyResultAccept()`:

```go
// Point state reads — zero value is a real value, not absence.
"eth_call",
"eth_getBalance",
"eth_getCode",
"eth_getStorageAt",
"eth_getTransactionCount",
```

`eth_getTransactionCount` returns `"0x0"` for a fresh account and is on the list
by that exact reasoning. These four return `"0x0"` for the same kind of real,
in-range answer and are **not**:

- `eth_getBlockTransactionCountByNumber` — `"0x0"` for an empty block
- `eth_getBlockTransactionCountByHash` — same
- `eth_getUncleCountByBlockNumber` — `"0x0"` for **every** post-merge block
- `eth_getUncleCountByBlockHash` — same

They meet the list's own inclusion criterion. Adding them is a one-line-per-entry
fix and is the minimal change this issue asks for.

(`eth_getBlockReceipts` and `eth_getTransactionReceipt` are deliberately handled
elsewhere — the `DefaultMarkEmptyAsErrorMethods` comment already explains the
`markEmptyAsError`/`emptyResultAccept` interaction for them — so this issue does
not touch those two.)

## Mechanism

`util/bytes.go`, `IsBytesEmptyish`, is a pure value test. It strips a `0x`
prefix and trims leading zeros, so a zero is empty whether quoted or not.
Verified by running the current function:

| input | `IsBytesEmptyish` |
|---|---|
| `"0x0"` | `true` |
| `0x0` | `true` |
| `"0x000"` | `true` |
| `"0x"` | `true` |
| `[]`, `null` | `true` |
| `"0x1"` | `false` |
| `"0x2cd"` | `false` |

`erpc/networks.go`, inside the upstream loop (~2233):

```go
emptyish := r.IsResultEmptyish()
acceptEmpty := !emptyish ||
    (!failsafeExecutor.HasConsensus() &&
        slices.Contains(failsafeExecutor.EmptyResultAccept(), method))
if acceptEmpty { return r, nil }
// otherwise emptyish results continue to the next upstream
```

The exemption is `slices.Contains` — exact string match, no wildcard, no shape
predicate. So the detector is shape-based and the exemption is name-based, and
the two can only ever agree by someone maintaining the list by hand.

One reason this is easy to miss in production: `ErrEndpointMissingData` maps to
HTTP 200, so eRPC reports success. The cost lands as latency, or is converted to
a 5xx by whatever fronts eRPC — the operator sees a slow or failing gateway, not
an eRPC retry loop.

## Measured impact

Five runs each, medians, mainnet through a gateway fronting eRPC. Block
`25948788` holds zero transactions; `25948789` holds 717 and is the control.

| Call | Result | Median |
|---|---|---|
| `eth_getUncleCountByBlockNumber`, ordinary FULL block | `"0x0"` | **645 ms** |
| `eth_getBlockTransactionCountByNumber`, empty block | `"0x0"` | 608 ms |
| `eth_getTransactionByBlockNumberAndIndex`, empty block | `null` | 645 ms |
| `eth_getBlockByHash`, unknown hash | `null` | 644 ms |
| `eth_getBlockTransactionCountByNumber`, FULL block (control) | `"0x2cd"` | 107 ms |
| `eth_getLogs` → `[]`, already on the list (control) | `[]` | 110 ms |

Two points the numbers make on their own:

1. Every unaccepted empty lands on the same fixed penalty (~610–645 ms here),
   whatever the method — it is retry-loop cost, not work.
2. An accepted empty costs what a cheap non-empty answer costs (110 ms vs
   107 ms).

Adding the four count methods to `emptyResultAccept` removed the penalty for
them in a controlled before/after on a live deployment: `eth_getUncleCountByBlockNumber`
645 ms → 97 ms, `eth_getBlockTransactionCountByNumber` 608 ms → 100 ms. The
methods left off stayed at ~630 ms, confirming the list is the cause.

In a worse case, a gateway with a per-attempt timeout in front of eRPC returned
HTTP 502 for 9–18 s per call on these methods (the sweep exhausting), which
stalled a chain indexer for days on a single empty block. The latency is the
visible half; a fronting timeout turning the exhausted sweep into a 5xx is the
expensive half.

## Suggested fixes

1. **Minimal:** add the four count methods to `DefaultEmptyResultAccept`. They
   meet the list's stated criterion and this closes the concrete regression.
2. **Structural (the real fix):** make the exemption shape-aware rather than a
   name list — e.g. a per-method `emptyIsValid` flag derived from the method
   config, or invert the default so only `markEmptyAsErrorMethods` needs
   maintaining. The two concepts (`emptyResultAccept` and
   `markEmptyAsErrorMethods`) already express one idea with opposite defaults;
   collapsing them would remove the class, not just this instance.

## Reproducing

Dependency-free, no credentials, prints nothing sensitive. Point it at any
endpoint fronting eRPC on Ethereum mainnet.

```python
import json, statistics, time, urllib.request

URL = "http://your-endpoint:8545"
EMPTY, FULL = 25948788, 25948789          # mainnet: 0 txs, and 717 txs
UNKNOWN = "0x" + "11" * 32

def bench(label, method, params, n=5):
    times, res = [], None
    for _ in range(n):
        req = urllib.request.Request(URL, headers={"content-type": "application/json"},
                                     data=json.dumps({"jsonrpc": "2.0", "id": 1,
                                                      "method": method, "params": params}).encode())
        t0 = time.time()
        res = json.loads(urllib.request.urlopen(req, timeout=90).read()).get("result")
        times.append(time.time() - t0)
    print(f"{label:52s} median {statistics.median(times)*1000:7.0f} ms  -> {res!r:.30}")

bench("uncle count, FULL block -> 0x0", "eth_getUncleCountByBlockNumber", [hex(FULL)])
bench("tx count, empty block -> 0x0", "eth_getBlockTransactionCountByNumber", [hex(EMPTY)])
bench("tx count, FULL block (control)", "eth_getBlockTransactionCountByNumber", [hex(FULL)])
bench("getLogs -> [] (already accepted, control)", "eth_getLogs",
      [{"fromBlock": hex(FULL), "toBlock": hex(FULL),
        "address": "0x000000000000000000000000000000000000dEaD"}])
```

The uncle-count line needs no special setup — any recent mainnet block reproduces it.
