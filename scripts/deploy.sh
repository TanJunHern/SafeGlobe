#!/usr/bin/env bash
# DueDilly: deploy to Cloud Run. YOU run this, not the coding agent. It creates and changes billable services.
#
#   bash scripts/deploy.sh uat           the app            -> duedilly-uat          (public link)
#   bash scripts/deploy.sh agents-uat    the ADK agents     -> duedilly-agents-uat   (private; only the app may call it)
#
# Order for a first deploy:  uat, then agents-uat, then uat again (so each knows the other's address).
# Settings come from .env.uat. Secrets never do: they come from Secret Manager (DEPLOY_GUIDE.md step 12).
# Needs: scripts/gcp-setup.sh run once, gcloud signed in, .env.uat filled in.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
PROJECT_ID="${PROJECT_ID:-safe-globe-compliance}"
REGION="${REGION:-asia-southeast1}"
SA_EMAIL="duedilly-run@${PROJECT_ID}.iam.gserviceaccount.com"
APP_SERVICE="duedilly-uat"
AGENTS_SERVICE="duedilly-agents-uat"
# 0 = scale to zero when idle (cheapest). Use MIN_INSTANCES=1 during a demo so data does not reset mid-demo.
MIN_INSTANCES="${MIN_INSTANCES:-0}"

case "$TARGET" in uat|agents-uat) ;; *) echo "Usage: bash scripts/deploy.sh <uat|agents-uat>"; exit 1 ;; esac
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found. DEPLOY_GUIDE.md step 0."; exit 1; }
[ -f .env.uat ] || { echo ".env.uat not found. Create it:  cp .env.example .env.uat   then fill it in (DEPLOY_GUIDE.md)."; exit 1; }
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 || { echo "Service account $SA_EMAIL not found. Run:  bash scripts/gcp-setup.sh"; exit 1; }

setting() { grep -E "^$1=" .env.uat | tail -1 | cut -d= -f2- || true; }
secret_ready() { [ -n "$(gcloud secrets versions list "$1" --project "$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' --limit 1 2>/dev/null)" ]; }
url_of() { gcloud run services describe "$1" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)' 2>/dev/null || true; }

ENV_YAML="$(mktemp)"
trap 'rm -f "$ENV_YAML"' EXIT
put() { [ -n "$2" ] && printf '%s: "%s"\n' "$1" "$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')" >> "$ENV_YAML"; return 0; }

secret_ready jwt-secret || { echo "Secret jwt-secret has no value. Run:  bash scripts/gcp-setup.sh"; exit 1; }
secret_ready agents-internal-token || { echo "Secret agents-internal-token has no value. Run:  bash scripts/gcp-setup.sh"; exit 1; }

APP_URL="$(url_of "$APP_SERVICE")"
AGENTS_URL="$(url_of "$AGENTS_SERVICE")"

if [ "$TARGET" = "agents-uat" ]; then
  MODEL="$(setting AGENTS_MODEL)"
  [ -n "$MODEL" ] || { echo "AGENTS_MODEL is not set in .env.uat (DEPLOY_GUIDE.md step 4)."; exit 1; }
  LOCATION="$(setting GOOGLE_CLOUD_LOCATION)"
  [ -n "$LOCATION" ] || { echo "GOOGLE_CLOUD_LOCATION is not set in .env.uat (DEPLOY_GUIDE.md step 4)."; exit 1; }
  put GOOGLE_GENAI_USE_VERTEXAI "TRUE"
  put GOOGLE_CLOUD_PROJECT "$PROJECT_ID"
  put GOOGLE_CLOUD_LOCATION "$LOCATION"
  put AGENTS_MODEL "$MODEL"
  put AGENTS_THINKING_LEVEL "$(setting AGENTS_THINKING_LEVEL)"
  put DUEDILLY_INTERNAL_URL "$APP_URL"
  [ -n "$APP_URL" ] || echo "NOTE: $APP_SERVICE is not deployed yet, so Ask Dilly's tools cannot reach it. Deploy uat, then run this again."

  echo "== Deploying $AGENTS_SERVICE (private, scales to zero) with model $MODEL in $LOCATION"
  gcloud run deploy "$AGENTS_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source agents \
    --service-account "$SA_EMAIL" --no-allow-unauthenticated \
    --min-instances 0 --max-instances 2 --memory 1Gi --cpu 1 --timeout 300 \
    --env-vars-file "$ENV_YAML" --set-secrets "AGENTS_INTERNAL_TOKEN=agents-internal-token:latest"
  # Only the app's service account may call the agents
  gcloud run services add-iam-policy-binding "$AGENTS_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --member "serviceAccount:$SA_EMAIL" --role roles/run.invoker --quiet >/dev/null
  echo
  echo "Agents service: $(url_of "$AGENTS_SERVICE")"
  echo "Next:  bash scripts/deploy.sh uat    (so the app learns this address)"
  exit 0
fi

# ---- the app ----
BACKEND="$(setting GEMINI_BACKEND)"
[ -n "$BACKEND" ] || { echo "GEMINI_BACKEND is not set in .env.uat: aistudio or vertex (DEPLOY_GUIDE.md steps 3 and 4)."; exit 1; }
SECRETS="JWT_SECRET=jwt-secret:latest,AGENTS_INTERNAL_TOKEN=agents-internal-token:latest"
if [ "$BACKEND" = "aistudio" ]; then
  secret_ready gemini-api-key || { echo "GEMINI_BACKEND=aistudio needs the secret gemini-api-key (DEPLOY_GUIDE.md step 12)."; exit 1; }
  SECRETS="$SECRETS,GEMINI_API_KEY=gemini-api-key:latest"
fi

put APP_ENV "uat"
put NODE_ENV "production"
put GEMINI_BACKEND "$BACKEND"
put GOOGLE_CLOUD_PROJECT "$PROJECT_ID"
put GCP_PROJECT_ID "$PROJECT_ID"
put AGENTS_SERVICE_URL "$AGENTS_URL"
put PUBLIC_BASE_URL "$APP_URL"
# Events (Phase 3). A push from Pub/Sub or Cloud Scheduler must carry a token made for this link, signed as the run service account.
put PUBSUB_PUSH_AUDIENCE "$APP_URL"
put PUBSUB_PUSH_SERVICE_ACCOUNT "$SA_EMAIL"
# Everything else is copied from .env.uat when it is set there. No secret is in this list.
for key in DEMO_MODE GOOGLE_CLOUD_LOCATION VERTEX_GEMINI_MODEL VERTEX_GEMINI_FALLBACK_MODELS GEMINI_MODEL GEMINI_FALLBACK_MODELS \
  GOOGLE_CLIENT_ID COMPLIANCE_OFFICER_EMAILS GOOGLE_MAPS_API_KEY WORKSPACE_NAME CONFIDENCE_THRESHOLD CORS_ORIGIN \
  AI_RATE_LIMIT_MAX AI_RATE_LIMIT_WINDOW_MINUTES POND_GUARD_DAILY_CAP VESSELFINDER_LOOKUP DOCUMENT_STORAGE GCS_BUCKET \
  PUBSUB_MODE CRAWLER_DAILY_CAP TRIAGE_DAILY_CAP AGENT_SEARCH_DATA_STORE AGENT_SEARCH_LOCATION AGENT_SEARCH_DAILY_CAP \
  BIGQUERY BIGQUERY_DATASET BIGQUERY_LOCATION BIGQUERY_MAX_BYTES_BILLED ML_TUNING_TRIALS ML_TRAIN_DAILY_CAP; do
  put "$key" "$(setting "$key")"
done
if [ "$(setting PUBSUB_MODE)" = "pubsub" ] && [ -z "$APP_URL" ]; then echo "NOTE: PUBSUB_MODE=pubsub needs the app's link. Deploy once more after this run, then run scripts/pubsub-subscriptions.sh."; fi
[ -n "$AGENTS_URL" ] || echo "NOTE: $AGENTS_SERVICE is not deployed yet, so Pond-Guard and Ask Dilly will use the offline fallback."

echo "== Deploying $APP_SERVICE (public link, one instance, min instances $MIN_INSTANCES)"
gcloud run deploy "$APP_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source . \
  --service-account "$SA_EMAIL" --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" --max-instances 1 --memory 512Mi --cpu 1 --timeout 300 \
  --env-vars-file "$ENV_YAML" --set-secrets "$SECRETS"
echo
echo "Your link: $(url_of "$APP_SERVICE")"
echo "Check it:  bash scripts/smoke.sh $(url_of "$APP_SERVICE")"
