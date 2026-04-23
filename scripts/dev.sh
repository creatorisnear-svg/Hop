#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  echo "[dev.sh] shutting down..."
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev.sh] starting api-server on :8080"
( PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev ) &

echo "[dev.sh] starting neuro-brain on :8081"
( PORT=8081 BASE_PATH=/ NODE_ENV=development pnpm --filter @workspace/neuro-brain run dev ) &

wait
