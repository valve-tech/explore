FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/web/package.json packages/web/
COPY shared/package.json shared/
RUN npm ci --workspace=packages/web --workspace=shared --include-workspace-root

COPY shared/ shared/
COPY packages/web/ packages/web/
# vite.config.ts statically imports build-info.mjs at config-load time to
# bake __BUILD_INFO__ into the bundle -- without this COPY the build fails
# to resolve the import.
COPY scripts/ scripts/

# Commit identity for a build with no .git dir -- promoted to ENV so
# build-info.mjs's `env.BUILD_SHA` override applies. Falls back to
# "unknown" gracefully when unset (see scripts/build-info.mjs).
ARG BUILD_SHA
ARG BUILD_COMMIT_ISO
ARG BUILD_BRANCH
ENV BUILD_SHA=${BUILD_SHA} \
    BUILD_COMMIT_ISO=${BUILD_COMMIT_ISO} \
    BUILD_BRANCH=${BUILD_BRANCH}

RUN npm run build --workspace=packages/web

# Serve with nginx
FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
