#!/usr/bin/env bash
# DueDilly: a spend cap. YOU run this, not the coding agent.
#
# Google Cloud has no built-in hard spending limit. This is Google's documented workaround: a budget publishes
# to a Pub/Sub topic, and a small function removes the billing account from the project once the cost passes
# the budget.
#
#   bash scripts/billing-cap.sh            cap at 80
#   CAP_USD=50 bash scripts/billing-cap.sh
#
# The amount is in your billing account's currency (check it in the console; the name CAP_USD assumes US dollars).
#
# READ THIS FIRST. When the cap fires:
#   - billing is removed from the project and EVERYTHING in it stops, including the DueDilly link;
#   - resources may be permanently deleted;
#   - it does not come back by itself: you must link billing again and redeploy (bash scripts/deploy.sh uat).
# And it is not exact: billing data arrives hours late, so spending can pass the cap before the function runs.
# Set the cap below what you can afford to lose. The budget counts the whole billing account, not only this
# project (your other projects have no billing linked, so today that is the same thing).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-safe-globe-compliance}"
REGION="${REGION:-asia-southeast1}"
CAP_USD="${CAP_USD:-80}"
TOPIC_ID="billing-cap"
FUNCTION="stop-billing-function"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found."; exit 1; }
BILLING_ACCOUNT_ID="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')"
[ -n "$BILLING_ACCOUNT_ID" ] || { echo "Project $PROJECT_ID has no billing account linked."; exit 1; }

cat <<MSG

This will create in project ${PROJECT_ID}:
  - Pub/Sub topic ${TOPIC_ID}
  - Cloud Run function ${FUNCTION} (${REGION}), which can remove billing from the project
  - a budget of USD ${CAP_USD} on billing account ${BILLING_ACCOUNT_ID} that notifies that topic
and give the function's service account the Billing Account Administrator role on that billing account.

When spending passes USD ${CAP_USD}, the project's services STOP, including the demo link.
MSG
read -r -p "Type the cap amount (${CAP_USD}) to confirm: " answer
[ "$answer" = "$CAP_USD" ] || { echo "Stopped. Nothing was created."; exit 0; }

echo "== 1. APIs"
gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com artifactregistry.googleapis.com \
  --project "$PROJECT_ID"

echo "== 2. Topic"
gcloud pubsub topics describe "$TOPIC_ID" --project "$PROJECT_ID" >/dev/null 2>&1 || gcloud pubsub topics create "$TOPIC_ID" --project "$PROJECT_ID"

echo "== 3. Function"
gcloud functions deploy "$FUNCTION" --gen2 --runtime=nodejs24 --region="$REGION" --trigger-topic="$TOPIC_ID" \
  --entry-point=stopBilling --set-env-vars GOOGLE_CLOUD_PROJECT="$PROJECT_ID" --source=./scripts/billing-cap --project="$PROJECT_ID"

echo "== 4. Let the function change billing"
SERVICE_ACCOUNT="$(gcloud functions describe "$FUNCTION" --region="$REGION" --format='value(serviceConfig.serviceAccountEmail)' --project="$PROJECT_ID")"
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT_ID" --member="serviceAccount:${SERVICE_ACCOUNT}" --role="roles/billing.admin"

echo "== 5. Budget"
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT_ID" --display-name="DueDilly spend cap (USD ${CAP_USD})" \
  --budget-amount="${CAP_USD}" --threshold-rule=percent=50 --threshold-rule=percent=90 --threshold-rule=percent=100 \
  --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC_ID}"

cat <<MSG

Done. The cap is armed at USD ${CAP_USD}. You also get emails at 50%, 90% and 100%.

To remove the cap (for example before judging, so the link cannot be switched off):
  gcloud functions delete ${FUNCTION} --region ${REGION} --project ${PROJECT_ID}
To bring the project back after the cap fired:
  gcloud billing projects link ${PROJECT_ID} --billing-account=${BILLING_ACCOUNT_ID}
  bash scripts/deploy.sh uat
MSG
