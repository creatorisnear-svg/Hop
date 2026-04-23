#!/usr/bin/env bash
set -euo pipefail

echo "[start.sh] pushing database schema..."
( cd /app/lib/db && /app/node_modules/.bin/drizzle-kit push --config ./drizzle.config.ts ) \
  || echo "[start.sh] WARN: drizzle push failed, continuing"

echo "[start.sh] starting api server on :${PORT:-8080}"
exec node --enable-source-maps /app/dist/index.mjs
