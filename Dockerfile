# Multi-stage build for Ligma app
FROM node:20-alpine AS base

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy workspace packages
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build shared package
WORKDIR /app/packages/shared
RUN pnpm run build

# Build server
WORKDIR /app/apps/server
RUN pnpm run build

# Build web frontend
WORKDIR /app/apps/web
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache sqlite

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/packages/shared/dist ./packages/shared/dist
COPY --from=base /app/packages/shared/package.json ./packages/shared/
COPY --from=base /app/apps/server/dist ./apps/server/dist
COPY --from=base /app/apps/server/package.json ./apps/server/
COPY --from=base /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=base /app/apps/web/dist ./apps/web/dist

# Create data directory for SQLite
RUN mkdir -p /app/apps/server/data

# Set working directory to server
WORKDIR /app/apps/server

# Expose port
EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:10000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "dist/index.js"]
