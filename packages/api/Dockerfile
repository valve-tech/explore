# ----------------------------------------------------------------------------
# Build stage — installs every workspace, builds sdk → api → web. The whole
# stage is discarded after we copy the dist directories into the production
# image.
# ----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Lockfile + each workspace's package.json so `npm ci` can resolve cleanly.
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/sdk/package.json packages/sdk/
COPY packages/web/package.json packages/web/
COPY shared/package.json shared/

# All workspaces, including dev deps (vite, tailwind, tsc, etc.).
RUN npm ci --include-workspace-root

# Sources
COPY shared/ shared/
COPY packages/sdk/ packages/sdk/
COPY packages/api/ packages/api/
COPY packages/web/ packages/web/
# packages/web/vite.config.ts statically imports build-info.mjs at config-load
# time (to bake __BUILD_INFO__ into the bundle) -- without this COPY the web
# build fails to resolve the import. It is also copied into the production
# stage below, where dist/lib/buildInfo.js re-imports it at API boot.
COPY scripts/ scripts/

# Commit identity for a build with no .git dir -- promoted to ENV so
# build-info.mjs's `env.BUILD_SHA` override applies to the Vite build below.
# An unset ARG resolves to an empty string, which the resolver treats as
# absent and falls back to "unknown" (verified via the no-args build).
ARG BUILD_SHA
ARG BUILD_COMMIT_ISO
ARG BUILD_BRANCH
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_COMMIT_ISO=${BUILD_COMMIT_ISO} \
    BUILD_BRANCH=${BUILD_BRANCH}

# Build order: sdk first (web imports its compiled dist), then api + web in parallel.
RUN npm run build --workspace=packages/sdk
RUN npm run build --workspace=packages/api && npm run build --workspace=packages/web

# ----------------------------------------------------------------------------
# Production stage — slim node:22-alpine, only the api + shared workspaces
# installed without dev deps. Copies the compiled api/dist and web/dist from
# the build stage.
# ----------------------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY shared/package.json shared/
RUN npm ci --workspace=packages/api --workspace=shared --include-workspace-root --omit=dev

COPY shared/ shared/
COPY --from=build /app/packages/api/dist packages/api/dist
COPY packages/api/migrations packages/api/migrations
COPY --from=build /app/packages/web/dist packages/web/dist
# dist/lib/buildInfo.js imports scripts/build-info.mjs at module scope, so
# it's a *runtime* import reached from packages/api/src/index.ts on boot --
# without this the container dies with ERR_MODULE_NOT_FOUND before /health
# ever comes up.
COPY scripts/ scripts/

# ARG does not cross stages -- redeclare + promote here so the running API
# resolves the real commit at boot instead of falling back to "unknown"
# (there's no .git in this image either).
ARG BUILD_SHA
ARG BUILD_COMMIT_ISO
ARG BUILD_BRANCH
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_COMMIT_ISO=${BUILD_COMMIT_ISO} \
    BUILD_BRANCH=${BUILD_BRANCH}

EXPOSE 10100
CMD ["node", "packages/api/dist/index.js"]
