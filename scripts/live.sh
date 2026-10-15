#!/usr/bin/env bash
# The live demo: the deployed Cloud Run service (not the local copy that `npm run uat` starts).
#
#   npm run live            find the link, check it is healthy, open it in the browser
#   npm run live -- check   find the link and check it, without opening the browser
#
# The link comes from gcloud (read-only) when it is signed in, otherwise from .env.uat.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="${UAT_SERVICE:-duedilly-uat}"
REGION="${REGION:-asia-southeast1}"
URL=""

if command -v gcloud >/dev/null 2>&1; then
  URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)' 2>/dev/null || true)"
fi
if [ -z "$URL" ] && [ -f .env.uat ]; then
  URL="$(grep -oE "https://${SERVICE}-[a-z0-9-]+\.a\.run\.app" .env.uat | head -1 || true)"
fi
if [ -z "$URL" ]; then
  echo "[live] No link found for $SERVICE. Deploy it first:  bash scripts/deploy.sh uat   (DEPLOY_GUIDE.md step 13)"
  exit 1
fi

echo "[live] $URL"
HEALTH="$(curl -s -m 20 "$URL/api/health" || true)"
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "[live] Healthy: $HEALTH"
else
  echo "[live] Not healthy (the first request after a quiet spell can take a few seconds; try again): ${HEALTH:-no answer}"
  exit 1
fi

[ "${1:-}" = "check" ] && exit 0
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
fi
