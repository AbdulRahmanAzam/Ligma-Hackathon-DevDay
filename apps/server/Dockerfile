# Multi-stage Dockerfile for Render free tier.
# - Builds the monorepo (server + shared) and the web app.
# - Installs Litestream as a sidecar that wraps the Node entrypoint.
# - Restores the SQLite DB from R2 on cold start so Render container churn
#   doesn't lose history.

FROM node:20-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @ligma/shared build
RUN pnpm --filter @ligma/server build
RUN pnpm --filter @ligma/web build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
ENV SQLITE_PATH=/var/lib/ligma/ligma.db

# Litestream binary (single static file).
ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget tini \
  && wget -q https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb \
  && dpkg -i litestream-v${LITESTREAM_VERSION}-linux-amd64.deb \
  && rm litestream-v${LITESTREAM_VERSION}-linux-amd64.deb \
  && rm -rf /var/lib/apt/lists/*

# Copy built workspace (only what we need at runtime).
COPY --from=builder /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/server/dist ./apps/server/dist
COPY --from=builder /repo/apps/server/package.json ./apps/server/package.json
COPY --from=builder /repo/apps/server/src/db/schema.sql ./apps/server/dist/db/schema.sql
COPY --from=builder /repo/apps/server/litestream.yml /etc/litestream.yml
COPY --from=builder /repo/apps/web/dist ./apps/web/dist
COPY --from=builder /repo/node_modules ./node_modules

RUN mkdir -p /var/lib/ligma

# Entrypoint: restore DB from R2 if missing, then run litestream replicate -exec node.
COPY apps/server/scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
