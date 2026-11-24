# Deploying `explore.valve.city`

Handoff doc for whoever is wiring up the production deployment. The
explore repo (this one) builds the artifact; the deploy repo (Caddy +
host config on `valve-prod`) decides where it runs and how the world
reaches it.

## What we're deploying

A single Node 22 container built from `packages/api/Dockerfile`. The
image is **self-contained** — it ships both the compiled API and the
built web SPA, served from one Express process on port **10100**.

| Surface | Path | Notes |
|---|---|---|
| API reference (Scalar UI) | `GET /docs` | HTML page bootstrapping Scalar against `/openapi.json` |
| OpenAPI 3.1 spec | `GET /openapi.json` | CORS-open (`Access-Control-Allow-Origin: *`), `Cache-Control: max-age=300` |
| Etherscan-shaped dispatcher | `GET\|POST /api?module=…&action=…` | covers proxy + account + contract + tx + block modules |
| Legacy REST | `GET /api/tx/:hash`, `/api/address/…`, `/api/block/…`, `/api/source/…` | being phased out into the dispatcher above |
| Trace simulator | `POST /api/simulate*` | viem + Anvil fork backend |
| SPA | everything else | served from `packages/web/dist`, single-page React Router |

The OpenAPI doc is the public-facing piece. The SPA is the
human-facing UI. Both live in the same container; one reverse proxy
fronts the lot.

## Runtime requirements

- **Port:** 10100 (configurable via `PORT` env var).
- **Postgres:** required. The container reads `DATABASE_URL`; default
  is `postgres://valvetech:valvetech@localhost:5432/valvetech` which
  is local-dev only. Production needs a real connection string.
- **PulseChain RPC:** the container reads `PULSECHAIN_RPC_URL`;
  default is the public `https://rpc.pulsechain.com`. For production
  point this at the internal RPC fleet
  (`https://direct-a-evm-369.valve.city` or equivalent — see
  `rpc-fleet` infra).
- **Debug RPC (optional):** `DEBUG_RPC_URL` enables `debug_*`-method
  features (tracer, debugger). Falls back to `PULSECHAIN_RPC_URL` if
  unset; for production this should point at a debug-enabled node.
- **Blockscout API (optional):** `BLOCKSCOUT_API_URL` defaults to
  `https://api.scan.pulsechain.com/api`. Override if proxying through
  an internal cache.

`.env` is **not** baked into the image — pass env vars at container
run time (compose, systemd EnvironmentFile, Kubernetes env, whatever
the deploy host uses).

## Build & registry

The image is currently built locally via:

```bash
docker build -f packages/api/Dockerfile -t explore-api:latest .
```

The repo has **no CI deploy workflow**. Whoever owns the deploy repo
needs to decide:

1. **Where the image is built.** Options:
   - GitHub Actions in the explore repo, pushing to ghcr.io on every
     main merge (needs a CI workflow added).
   - In the deploy repo, pulling this repo as a submodule or via
     `git clone` + `docker build`.
   - Locally by an operator, pushed to a private registry.
2. **Where the image is pulled from.** Wherever the rest of the
   `*.valve.city` fleet pulls from. If nothing else exists,
   `ghcr.io/valve-tech/explore-api` is the natural slot.

## Where it runs

The container needs to be reachable from `valve-prod`'s Caddy
(88.99.192.187). Two viable shapes:

- **Co-located on valve-prod itself.** Container binds to
  `127.0.0.1:10100`; Caddy proxies localhost. Simplest, but couples
  Caddy reloads and the app's restart lifecycle to one box.
- **Separate app host.** Container runs on a dedicated host
  (`explore-app.valve.internal` or similar); Caddy proxies over the
  private network. Cleaner separation, requires another box.

Recommend co-located for v1 unless the rpc-fleet pattern (separate
`direct-*` boxes) is the established convention for app workloads
too.

## Caddy site block

Add to `/etc/caddy/Caddyfile` on `valve-prod`. **Follow the valve
Caddy editing discipline** — the 2026-05-19 incident is why these
site blocks need careful review (no in-place edits without validate,
no `caddy reload --force`).

```caddyfile
explore.valve.city {
    # Reverse-proxy to wherever the container runs.
    # Replace with the actual upstream when known.
    reverse_proxy localhost:10100

    # The OpenAPI handler already sets Access-Control-Allow-Origin: *
    # on /openapi.json. Don't strip or override it — off-host docs
    # editors (incl. one.valve.city's federation viewer) need it.

    encode gzip zstd
    log {
        output file /var/log/caddy/explore.valve.city.log
        format json
    }
}
```

**Before reloading Caddy:**

1. `caddy validate --config /etc/caddy/Caddyfile` — must pass.
2. Diff the rendered config (`caddy adapt`) to confirm only the new
   site block changed.
3. Reload with `systemctl reload caddy`, **not** `caddy reload --force`.
4. Smoke-test from outside the box:

   ```bash
   curl -fsS https://explore.valve.city/openapi.json | head -c 200
   curl -fsS -o /dev/null -w "HTTP %{http_code}\n" https://explore.valve.city/docs
   ```

   Both should return 200.

## Federation registration

Per the OpenAPI commit (`2151ca2`), the federation pattern is:

```
one.valve.city/                   ← root manifest
  └─ services[0].docs.openapi     ← points at:
       explore.valve.city/openapi.json
```

To complete federation, the maintainer of `one.valve.city`'s manifest
needs to add the entry. That repo is separate from this one. Once the
Caddy block is live, send them this URL:

```
https://explore.valve.city/openapi.json
```

## Verification checklist

After Caddy reload, validate from outside `valve-prod`:

- [ ] `curl -fsS https://explore.valve.city/openapi.json | jq .info.title`
      returns `"valve · explore.valve.city"`.
- [ ] `curl -fsSI https://explore.valve.city/openapi.json | grep -i access-control-allow-origin`
      returns `*`.
- [ ] `https://explore.valve.city/docs` loads the Scalar UI in a
      browser, and the "Try it" tab can issue requests against the
      dispatcher.
- [ ] `curl -fsS "https://explore.valve.city/api?module=proxy&action=eth_blockNumber"`
      returns a non-zero block number, proving the RPC fleet is wired
      up correctly.
- [ ] The SPA loads at `https://explore.valve.city/` and is able to
      look up a block via the address bar.

## Rollback

The image is stateless aside from Postgres (which only holds
verified-source cache + future labels data, both regenerable).
Rollback is:

1. Revert the Caddy site block (remove the `explore.valve.city` entry
   or set it to return 503).
2. `systemctl reload caddy` after `caddy validate`.
3. Stop the container.

Postgres is left intact across rollbacks; no migration rollback is
required for this initial deploy because there are no destructive
migrations in the image.

## What the explore repo can do to support this

- Add a GitHub Actions workflow that builds + pushes the image on
  main merge — needs a registry target and credentials.
- Add a `compose.prod.yml` overlay if the deploy uses Docker Compose
  on the host.
- Add a healthcheck endpoint to the Express server if the deploy
  needs one (currently the container's only readiness signal is being
  port-bound).

Ping the explore repo owner with the deploy-repo path and the chosen
registry and they'll prep whichever of the above are useful.

---

# IPFS frontend (self-serve mirror)

A second, independent deploy surface: the SPA pinned to IPFS so the UI
self-serves if `explore.valve.city` is down. This is **frontend only** —
it still calls the same backend (`explore.valve.city/api`), baked into
the bundle at build time. The container deploy above is unaffected.

## How it differs from the canonical build

`npm run build:ipfs` (vs `npm run build`) flips three coupled things via
`VITE_IPFS=1`. Both builds use a HashRouter (`/#/tx/0x…`); the canonical
build also moves an EIP-3091 path URL (`/tx/0x…`) into the hash at load.

| | canonical (`build`) | IPFS (`build:ipfs`) |
|---|---|---|
| asset paths | absolute `/assets/…` | relative `./assets/…` |
| path URL (`/tx/0x…`) | moved into the hash at load | not a route (the path is the gateway's) |
| backend origin | same-origin (empty) | baked `https://explore.valve.city` |

Relative assets are mandatory under `/ipfs/<CID>/`, and relative assets
are only safe while the document path stays at the root (a nested path
resolves `./assets` against the wrong base). The canonical build serves
the app at deep paths, so it keeps absolute assets. The backend origin is baked because
the gateway origin is not our backend. Override per-browser via
`localStorage["explore:apiBase"]`; the `?api=` query override is
deliberately unsupported (phishing).

## Deploying

Self-hosted kubo node (the indexer box's node — where chifra publishes
its unchained index). One command, run **on the node box** or through an
SSH tunnel to its API:

```bash
# on the box (kubo API at localhost:5001):
npm run deploy:ipfs

# from elsewhere — tunnel the node's API first:
ssh -N -L 5001:127.0.0.1:5001 <indexer-box> &
npm run deploy:ipfs
```

`scripts/deploy-ipfs.sh` builds, adds + pins the directory (CIDv1), and
prints the CID + the DNSLink TXT record to set. It **does not touch DNS**
and holds no secrets. Env knobs: `IPFS_API_ADDR`
(default `/ip4/127.0.0.1/tcp/5001`), `DNSLINK_DOMAIN`
(default `ipfs.explore.valve.city`), `SKIP_BUILD=1` to pin an existing
`dist/`.

The build is **deterministic** — identical source yields an identical
CID, so you can diff the printed CID against the previous release before
moving DNS.

## Locating the kubo node (operator step)

The repo doesn't hard-code the node address (it's fleet infra, off-limits
to in-repo tooling). To confirm where it lives, on the indexer box:

```bash
ipfs id --api /ip4/127.0.0.1/tcp/5001            # is a node answering?
systemctl status ipfs kubo 2>/dev/null           # how it's managed
ss -ltnp | grep 5001                             # what's bound to the API port
```

Chifra/TrueBlocks runs its own IPFS for the unchained index; confirm
whether to reuse that node or run a dedicated one for the SPA before
pinning.

## DNSLink

After pinning, set the TXT record the script prints:

```
_dnslink.ipfs.explore.valve.city.  TXT  "dnslink=/ipfs/<CID>"
```

Then a DNSLink-aware gateway (or `ipfs.explore.valve.city` fronted by a
gateway) resolves the latest pin. Re-running `deploy:ipfs` produces a new
CID on every content change; update the TXT record to roll the release
forward (and keep the prior CID pinned for instant rollback).
