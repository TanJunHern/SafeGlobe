#!/usr/bin/env bash
# DueDilly: connect Pub/Sub and Cloud Scheduler to the deployed app. YOU run this, not the coding agent,
# once, after the first deploy (it needs the app's link).
#
#   bash scripts/pubsub-subscriptions.sh           create or update the push subscriptions and the crawl schedule
#   bash scripts/pubsub-subscriptions.sh check     read-only: list them
#
# What it creates (all idempotent):
#   - one push subscription per uat-* topic, delivering to  <link>/events/<event>
#   - the Cloud Scheduler job duedilly-uat-crawl-due, calling  <link>/events/crawl-due  once a week (Mondays, 06:30 Singapore time)
#     Another schedule:  CRAWL_SCHEDULE="30 6 * * *" bash scripts/pubsub-subscriptions.sh   (that one is daily)
# Every delivery carries a Google-signed token for the service account duedilly-run, made for the app's link.
# The app refuses anything else.
#
# Cost: Pub/Sub's first 10 GiB a month are free; these events are a few bytes each.
# Cloud Scheduler: 3 jobs free per billing account; with duedilly-uat-rescreen-due this makes 2.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-safe-globe-compliance}"
REGION="${REGION:-asia-southeast1}"
ENV_NAME="uat"
SERVICE="duedilly-uat"
SA_EMAIL="duedilly-run@${PROJECT_ID}.iam.gserviceaccount.com"
EVENTS=(screening-requested screening-completed ddq-submitted alert-raised rescreen-due source-changed)
CRAWL_JOB="duedilly-uat-crawl-due"
# Once a week keeps the demo cheap: each run is one Gemini call per website source. "Run now" in the Sources tab reads at any time.
CRAWL_SCHEDULE="${CRAWL_SCHEDULE:-30 6 * * 1}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found. DEPLOY_GUIDE.md step 0."; exit 1; }

if [ "${1:-}" = "check" ]; then
  gcloud pubsub subscriptions list --project "$PROJECT_ID" --format='table(name.basename(),pushConfig.pushEndpoint,pushConfig.oidcToken.serviceAccountEmail)'
  gcloud scheduler jobs list --location "$REGION" --project "$PROJECT_ID" --format='table(name.basename(),schedule,timeZone,state)'
  exit 0
fi

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
[ -n "$URL" ] || { echo "$SERVICE is not deployed yet. Run:  bash scripts/deploy.sh uat"; exit 1; }
echo "App link: $URL"

echo "== 1. Pub/Sub may sign deliveries as ${SA_EMAIL}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project "$PROJECT_ID" \
  --member "serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --quiet >/dev/null
echo "   ok"

echo "== 2. Push subscriptions"
for event in "${EVENTS[@]}"; do
  topic="${ENV_NAME}-${event}"
  sub="${topic}-push"
  args=(--push-endpoint "${URL}/events/${event}" --push-auth-service-account "$SA_EMAIL" --push-auth-token-audience "$URL")
  if gcloud pubsub subscriptions describe "$sub" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud pubsub subscriptions modify-push-config "$sub" --project "$PROJECT_ID" "${args[@]}" >/dev/null
    echo "   updated: $sub"
  else
    # A re-screen can take a minute, so the app gets 5 minutes to answer; a message is retried for at most a day
    gcloud pubsub subscriptions create "$sub" --project "$PROJECT_ID" --topic "$topic" "${args[@]}" \
      --ack-deadline 300 --message-retention-duration 1d --min-retry-delay 30s --max-retry-delay 600s >/dev/null
    echo "   created: $sub"
  fi
done

echo "== 3. Cloud Scheduler: read every website source on the schedule \"${CRAWL_SCHEDULE}\" (Singapore time; the default is Mondays at 06:30)"
job_args=(--location "$REGION" --project "$PROJECT_ID" --schedule "$CRAWL_SCHEDULE" --time-zone "Asia/Singapore"
  --uri "${URL}/events/crawl-due" --http-method POST --headers "Content-Type=application/json" --message-body '{"source":"cloud-scheduler"}'
  --oidc-service-account-email "$SA_EMAIL" --oidc-token-audience "$URL" --attempt-deadline 600s)
if gcloud scheduler jobs describe "$CRAWL_JOB" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$CRAWL_JOB" "${job_args[@]}" >/dev/null
  echo "   updated: $CRAWL_JOB"
else
  gcloud scheduler jobs create http "$CRAWL_JOB" "${job_args[@]}" >/dev/null
  echo "   created: $CRAWL_JOB"
fi

cat <<DONE

Done. Now, in .env.uat, uncomment and set:
  PUBSUB_MODE=pubsub
(PUBSUB_PUSH_AUDIENCE and PUBSUB_PUSH_SERVICE_ACCOUNT are filled in by scripts/deploy.sh.)
Then redeploy:  bash scripts/deploy.sh uat
Try the schedule without waiting for the morning:
  gcloud scheduler jobs run ${CRAWL_JOB} --location ${REGION} --project ${PROJECT_ID}
DONE
