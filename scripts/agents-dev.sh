#!/usr/bin/env bash
# The ADK agents service on your computer: http://localhost:8090 (Pond-Guard, Ask Dilly).
#
#   npm run agents          start it, settings from .env.dev (or APP_ENV=uat for .env.uat)
#   npm run test:agents     run its offline tests
#
# It uses the Python that the ADK was installed with (uv tool google-adk), so no second install is needed.
# Without a Gemini backend and AGENTS_MODEL in the settings file it still starts, answers 503, and the app
# shows its offline fallback.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${AGENTS_PYTHON:-$HOME/.local/share/uv/tools/google-adk/bin/python}"
if [ ! -x "$PY" ]; then
  echo "[agents] Python with the ADK not found at $PY."
  echo "[agents] Install it:  uv tool install google-adk==2.11.0   (or set AGENTS_PYTHON to a Python that has agents/requirements.txt installed)"
  exit 1
fi

if [ "${1:-}" = "test" ]; then
  cd agents
  exec "$PY" -W ignore::DeprecationWarning -m unittest discover -s tests
fi

ENV_FILE=".env.${APP_ENV:-dev}"
if [ -f "$ENV_FILE" ]; then
  # Only the lines the agents need are read; the file is not sourced as a script
  while IFS='=' read -r key value; do
    case "$key" in
      AGENTS_MODEL|AGENTS_THINKING_LEVEL|AGENTS_INTERNAL_TOKEN|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_CLOUD_PROJECT|GOOGLE_CLOUD_LOCATION|GOOGLE_API_KEY|GEMINI_API_KEY|DUEDILLY_INTERNAL_URL)
        [ -n "$value" ] && export "$key=$value" ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$ENV_FILE" || true)
else
  echo "[agents] $ENV_FILE not found: starting with no settings (offline, answers 503)."
fi
export DUEDILLY_INTERNAL_URL="${DUEDILLY_INTERNAL_URL:-http://localhost:8080}"

echo "[agents] Starting on http://localhost:${AGENTS_PORT:-8090}  (model: ${AGENTS_MODEL:-none set})"
cd agents
exec "$PY" -m uvicorn app.main:app --host "${AGENTS_HOST:-0.0.0.0}" --port "${AGENTS_PORT:-8090}"
