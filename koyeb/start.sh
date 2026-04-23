#!/usr/bin/env bash
set -euo pipefail

echo "[start.sh] pushing database schema..."
pnpm --filter @workspace/db run push || echo "[start.sh] WARN: drizzle push failed, continuing"

echo "[start.sh] starting api server on :${PORT:-8080}"
exec node --enable-source-maps ./dist/index.mjs
