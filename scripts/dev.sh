#!/usr/bin/env bash
# DEV port: http://localhost:8080, hot reload, settings from .env.dev. Works offline.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.dev ]; then
  echo "[dev] .env.dev not found. Create it with:  cp .env.example .env.dev   (or: cp .env .env.dev)"
  [ -f .env ] && echo "[dev] Falling back to .env for this run."
fi

# Local services (Pub/Sub emulator). The app does not need them yet, so a missing Docker is only a warning.
if docker info >/dev/null 2>&1; then
  docker compose -f docker-compose.dev.yml up -d
else
  echo "[dev] Docker is not running: skipping the Pub/Sub emulator. The app itself still starts."
fi

export APP_ENV=dev
export PORT="${PORT:-8080}"
exec node --watch src/server.js
