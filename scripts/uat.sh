#!/usr/bin/env bash
# UAT port: http://localhost:8081, running the same production image Cloud Run runs, settings from .env.uat.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="duedilly:uat"
ADC="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"

if [ ! -f .env.uat ]; then
  echo "[uat] .env.uat not found. Create it with:  cp .env.example .env.uat  and fill in the UAT values."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "[uat] Docker is not running: falling back to direct Node runtime on http://localhost:8081 (settings from .env.uat)."
  export APP_ENV=uat
  export PORT="${PORT:-8081}"
  exec node src/server.js
fi

echo "[uat] Building the production image ($IMAGE)..."
docker build -t "$IMAGE" .

# Application Default Credentials, read-only, so Google Cloud clients inside the container can sign in as you
CREDS=()
if [ -f "$ADC" ]; then
  CREDS=(-v "$ADC:/secrets/adc.json:ro" -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/adc.json)
else
  echo "[uat] No Application Default Credentials at $ADC."
  echo "[uat] Run:  gcloud auth application-default login   (needed for Vertex AI, Cloud Storage and other Google Cloud services)"
fi

# Inside the container "localhost" is the container itself. An agents service running on this computer
# (APP_ENV=uat npm run agents) is reached as host.docker.internal instead.
AGENTS=()
AGENTS_URL="$(grep -E '^AGENTS_SERVICE_URL=' .env.uat | tail -1 | cut -d= -f2- || true)"
case "$AGENTS_URL" in
  http://localhost:*|http://127.0.0.1:*)
    AGENTS=(--add-host host.docker.internal:host-gateway -e "AGENTS_SERVICE_URL=http://host.docker.internal:${AGENTS_URL##*:}")
    echo "[uat] Agents service: this computer, port ${AGENTS_URL##*:} (start it with: APP_ENV=uat npm run agents)" ;;
esac

echo "[uat] Starting on http://localhost:8081"
# .env.uat is mounted, not baked in: the app reads it itself, exactly as it reads .env.dev on the dev port
exec docker run --rm --name duedilly-uat \
  -p 8081:8080 \
  -v "$PWD/.env.uat:/app/.env.uat:ro" \
  -e APP_ENV=uat -e PORT=8080 \
  ${CREDS[@]+"${CREDS[@]}"} \
  ${AGENTS[@]+"${AGENTS[@]}"} \
  "$IMAGE"
