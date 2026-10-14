#!/usr/bin/env bash
# DueDilly: one-time Google Cloud setup (plan Phase 2, docs/CLOUD_PLAN.md).
#
# YOU run this, not the coding agent. It creates real resources in your project.
# Safe to run twice: every step checks whether the thing exists before creating it.
#
#   bash scripts/gcp-setup.sh
#   PROJECT_ID=another-project REGION=asia-southeast1 bash scripts/gcp-setup.sh
#
# Needs: gcloud CLI (with bq), `gcloud auth login`, and billing enabled on the project.
#
# Not created here, on purpose:
#   - Cloud SQL and the db-password secret: the app stays on SQLite for now (plan step 3a).
#   - Document AI processor, Agent Search data store, budget alert: console steps, printed at the end.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-safe-globe-compliance}"
REGION="${REGION:-asia-southeast1}"
SA_NAME="duedilly-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
ENVS=(dev uat)
EVENTS=(screening-requested screening-completed ddq-submitted alert-raised rescreen-due source-changed)
BUDGET_USD=50

step() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   WARNING: %s\n' "$*"; }

# ---------------------------------------------------------------------------------------------
step "Checks before anything is created"
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v bq >/dev/null 2>&1 || { echo "bq not found. It ships with the gcloud CLI: run 'gcloud components install bq'."; exit 1; }
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)"
[ -n "$ACCOUNT" ] || { echo "Not signed in. Run: gcloud auth login"; exit 1; }
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || { echo "Project '$PROJECT_ID' not found, or $ACCOUNT cannot see it."; exit 1; }
BILLING="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
if [ "$BILLING" != "True" ]; then
  echo "Billing is not enabled on '$PROJECT_ID'. Link the project to your Free Trial billing account first:"
  echo "  https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  exit 1
fi
info "Signed in as:  $ACCOUNT"
info "Project:       $PROJECT_ID (billing enabled)"
info "Region:        $REGION"

cat <<EOF

This will create, if they do not exist yet:
  - service account ${SA_NAME} with its roles
  - secrets gemini-api-key, jwt-secret and agents-internal-token
  - buckets duedilly-dev-${PROJECT_ID} and duedilly-uat-${PROJECT_ID} (${REGION})
  - BigQuery datasets duedilly_dev and duedilly_uat (${REGION})
  - ${#EVENTS[@]} Pub/Sub topics per environment (dev-*, uat-*)
  - one Cloud Scheduler job publishing uat-rescreen-due every day

Free Trial notes:
  - The \$300 credit does not pay for the Gemini API in Google AI Studio.
  - You cannot request quota increases during the trial.
  - Buckets in ${REGION} are outside the Cloud Storage free tier (cents per GB, from the credit).
  - A budget alert only sends email. It does NOT stop spending.
EOF
read -r -p "Continue? [y/N] " answer
[[ "$answer" =~ ^[Yy]$ ]] || { echo "Stopped. Nothing was created."; exit 0; }

# ---------------------------------------------------------------------------------------------
step "1. Project and region"
gcloud config set project "$PROJECT_ID" --quiet
gcloud config set run/region "$REGION" --quiet

# ---------------------------------------------------------------------------------------------
step "2. Enable APIs (already-enabled ones are skipped by Google)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  bigquery.googleapis.com \
  aiplatform.googleapis.com \
  documentai.googleapis.com \
  discoveryengine.googleapis.com \
  cloudscheduler.googleapis.com \
  bigqueryconnection.googleapis.com \
  gmail.googleapis.com \
  iamcredentials.googleapis.com \
  --project "$PROJECT_ID"
info "sqladmin is enabled for later (plan step 3b). No Cloud SQL instance is created here."

# ---------------------------------------------------------------------------------------------
step "3. Service account ${SA_NAME} (what the Cloud Run services run as)"
if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  info "exists: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" --display-name "DueDilly Cloud Run runtime"
fi
# Least privilege. roles/cloudsql.client is left out until the Postgres step (3b) is approved.
ROLES=(
  roles/aiplatform.user
  roles/documentai.apiUser
  roles/discoveryengine.user
  roles/bigquery.dataEditor
  roles/bigquery.jobUser
  roles/pubsub.publisher
)
for role in "${ROLES[@]}"; do
  if gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$SA_EMAIL" --role "$role" --condition=None --quiet >/dev/null 2>&1; then
    info "granted $role"
  else
    warn "could not grant $role. Check the role name in the console (IAM > Grant access) and grant it by hand."
  fi
done

# ---------------------------------------------------------------------------------------------
step "4. Secrets (values are never printed)"
ensure_secret() {
  gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1 || gcloud secrets create "$1" --project "$PROJECT_ID" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT_ID" --member "serviceAccount:$SA_EMAIL" --role roles/secretmanager.secretAccessor --quiet >/dev/null
}
has_version() { [ -n "$(gcloud secrets versions list "$1" --project "$PROJECT_ID" --filter='state=ENABLED' --format='value(name)' --limit 1 2>/dev/null)" ]; }

ensure_secret gemini-api-key
if has_version gemini-api-key; then
  info "gemini-api-key already has a value (left as it is)"
else
  read -r -s -p "   Paste your Google AI Studio API key (input hidden, Enter to skip): " GEMINI_KEY; echo
  if [ -n "$GEMINI_KEY" ]; then
    printf '%s' "$GEMINI_KEY" | gcloud secrets versions add gemini-api-key --project "$PROJECT_ID" --data-file=- >/dev/null
    info "gemini-api-key saved"
  else
    warn "gemini-api-key has no value yet. Add one before deploying with GEMINI_BACKEND=aistudio."
  fi
  unset GEMINI_KEY
fi

# Signs the DDQ links. The app refuses to start in uat without its own value.
ensure_secret jwt-secret
if has_version jwt-secret; then
  info "jwt-secret already has a value (left as it is)"
else
  openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add jwt-secret --project "$PROJECT_ID" --data-file=- >/dev/null
  info "jwt-secret generated and saved"
fi

# Shared by the app and the agents service, so each can tell the other's calls from anyone else's
ensure_secret agents-internal-token
if has_version agents-internal-token; then
  info "agents-internal-token already has a value (left as it is)"
else
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add agents-internal-token --project "$PROJECT_ID" --data-file=- >/dev/null
  info "agents-internal-token generated and saved"
fi
info "Secret Manager free tier: 6 active secret versions. This script uses 3."

# ---------------------------------------------------------------------------------------------
step "5. Buckets, BigQuery datasets and Pub/Sub topics for dev and uat"
for env in "${ENVS[@]}"; do
  bucket="duedilly-${env}-${PROJECT_ID}"
  if gcloud storage buckets describe "gs://${bucket}" >/dev/null 2>&1; then
    info "bucket exists: gs://${bucket}"
  else
    gcloud storage buckets create "gs://${bucket}" --project "$PROJECT_ID" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  fi
  # Object access on these two buckets only, not project-wide
  gcloud storage buckets add-iam-policy-binding "gs://${bucket}" --member "serviceAccount:$SA_EMAIL" --role roles/storage.objectAdmin --quiet >/dev/null
  info "${SA_NAME} can read and write gs://${bucket}"

  dataset="duedilly_${env}"
  if bq --project_id "$PROJECT_ID" show --dataset "${PROJECT_ID}:${dataset}" >/dev/null 2>&1; then
    info "dataset exists: ${dataset}"
  else
    bq --project_id "$PROJECT_ID" --location "$REGION" mk --dataset --description "DueDilly ${env} analytics" "${PROJECT_ID}:${dataset}"
  fi

  for event in "${EVENTS[@]}"; do
    topic="${env}-${event}"
    if gcloud pubsub topics describe "$topic" --project "$PROJECT_ID" >/dev/null 2>&1; then
      info "topic exists: ${topic}"
    else
      gcloud pubsub topics create "$topic" --project "$PROJECT_ID"
    fi
  done
done

# ---------------------------------------------------------------------------------------------
step "6. Cloud Scheduler: publish uat-rescreen-due once a day (06:00 Singapore time)"
JOB="duedilly-uat-rescreen-due"
if gcloud scheduler jobs describe "$JOB" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  info "job exists: ${JOB}"
else
  gcloud scheduler jobs create pubsub "$JOB" \
    --project "$PROJECT_ID" --location "$REGION" \
    --schedule "0 6 * * *" --time-zone "Asia/Singapore" \
    --topic "uat-rescreen-due" \
    --message-body '{"event":"rescreen-due","source":"cloud-scheduler"}' \
    --description "DueDilly: re-screen monitored counterparties that are due"
fi
info "Nothing listens to this topic until the push subscription is added after the first deploy (plan Phase 5 / 7)."
info "Cloud Scheduler free tier: 3 jobs per billing account. This is 1."

# ---------------------------------------------------------------------------------------------
step "Done. Three things only you can do, in the console"
cat <<EOF

1. BUDGET ALERT (do this first)
   https://console.cloud.google.com/billing/budgets
   Create a budget of USD ${BUDGET_USD} for project ${PROJECT_ID} with email alerts at 50%, 90% and 100%.
   REMINDER: an alert only sends email. It does NOT stop spending. To stop spending you must
   delete the resources or disable billing on the project yourself.

2. DOCUMENT AI PROCESSOR (for DDQ PDFs)
   https://console.cloud.google.com/ai/document-ai/processors?project=${PROJECT_ID}
   Create a "Form Parser" processor. Note the location you pick (often "us" or "eu") and the processor ID,
   then send both to the coding agent. They go into DOCUMENT_AI_LOCATION and DOCUMENT_AI_PROCESSOR_ID.
   Form Parser is billed per page from the credit; there is no free tier.

3. AGENT SEARCH DATA STORE (policy retrieval)
   https://console.cloud.google.com/gen-app-builder/data-stores?project=${PROJECT_ID}
   Wait until the coding agent has exported the policy files (plan Phase 4), upload them to
   gs://duedilly-uat-${PROJECT_ID}/policies/, then create a data store with ID "duedilly-policies"
   from that folder. Note the location you pick (often "global").

Values for .env.uat:
   GOOGLE_CLOUD_PROJECT=${PROJECT_ID}
   GOOGLE_CLOUD_LOCATION=<the Vertex AI location your chosen model is served in, DEPLOY_GUIDE.md step 4>
   (bucket for uploads, used from plan step 3a: duedilly-uat-${PROJECT_ID})

To check what exists at any time (read-only):
   gcloud iam service-accounts list --project ${PROJECT_ID}
   gcloud secrets list --project ${PROJECT_ID}
   gcloud storage buckets list --project ${PROJECT_ID} --format='value(name,location)'
   bq ls --project_id ${PROJECT_ID}
   gcloud pubsub topics list --project ${PROJECT_ID} --format='value(name)'
   gcloud scheduler jobs list --location ${REGION} --project ${PROJECT_ID}
EOF
