#!/usr/bin/env bash
set -e

DB="${SQLITE_PATH:-/var/lib/ligma/ligma.db}"

# Restore from R2 on cold start. Idempotent: skips if DB already exists.
if [ ! -f "$DB" ]; then
  echo "[entrypoint] DB missing; attempting litestream restore..."
  litestream restore -if-replica-exists -config /etc/litestream.yml "$DB" || \
    echo "[entrypoint] no replica yet, will create fresh DB"
fi

# Replicate as a child process while node runs in the foreground.
exec litestream replicate -config /etc/litestream.yml -exec "node /app/apps/server/dist/index.js"
