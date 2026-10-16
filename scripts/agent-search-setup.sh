#!/usr/bin/env bash
# DueDilly: Agent Search (formerly Vertex AI Search) for policy search. YOU run this, not the coding agent.
# It uploads the policy files to your UAT bucket and creates and fills the data store "duedilly-policies".
#
#   bash scripts/agent-search-setup.sh            upload, create the data store if missing, import the files
#   bash scripts/agent-search-setup.sh check      read-only: is the data store there, and does a search answer?
#
# Cost: Agent Search bills per search (see DEPLOY_GUIDE.md step 8). Creating the data store and importing these
# eight small files costs nothing by itself; the app caps its searches per day (AGENT_SEARCH_DAILY_CAP).
# Needs: scripts/gcp-setup.sh run once, gcloud signed in, node (to build the files).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-safe-globe-compliance}"
LOCATION="${AGENT_SEARCH_LOCATION:-global}"
DATA_STORE="${AGENT_SEARCH_DATA_STORE:-duedilly-policies}"
BUCKET="${GCS_BUCKET:-duedilly-uat-${PROJECT_ID}}"
HOST="discoveryengine.googleapis.com"
[ "$LOCATION" = "global" ] || HOST="${LOCATION}-discoveryengine.googleapis.com"
BASE="https://${HOST}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found. DEPLOY_GUIDE.md step 0."; exit 1; }
call() { # method, url, [json body]
  local method="$1" url="$2" body="${3:-}"
  curl -sS -X "$method" "$url" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "X-Goog-User-Project: ${PROJECT_ID}" -H "Content-Type: application/json" \
    ${body:+-d "$body"}
}
search() {
  call POST "${BASE}/dataStores/${DATA_STORE}/servingConfigs/default_serving_config:search" \
    '{"query":"Clause 5.4 maritime vessels AIS","pageSize":3,"contentSearchSpec":{"snippetSpec":{"returnSnippet":true}}}'
}

if [ "${1:-}" = "check" ]; then
  echo "== Data store ${DATA_STORE} in ${LOCATION}"
  call GET "${BASE}/dataStores/${DATA_STORE}" | head -c 600; echo
  echo "== A test search (files can take some minutes to become searchable after an import)"
  search | head -c 1500; echo
  exit 0
fi

echo "== 1. Building the policy files (docs/policies/)"
node scripts/build-policy-files.js

echo "== 2. Uploading them to gs://${BUCKET}/policies/"
gcloud storage cp docs/policies/* "gs://${BUCKET}/policies/" --project "$PROJECT_ID"

echo "== 3. The data store ${DATA_STORE}"
if call GET "${BASE}/dataStores/${DATA_STORE}" | grep -q '"name"'; then
  echo "   exists"
else
  # An unstructured-document search data store: each file is one document
  call POST "${BASE}/dataStores?dataStoreId=${DATA_STORE}" \
    '{"displayName":"DueDilly policies","industryVertical":"GENERIC","solutionTypes":["SOLUTION_TYPE_SEARCH"],"contentConfig":"CONTENT_REQUIRED"}' | head -c 400; echo
  echo "   created (this can take a minute to finish)"
  sleep 20
fi

echo "== 4. Importing the files (a full refresh: the data store ends up with exactly these files)"
call POST "${BASE}/dataStores/${DATA_STORE}/branches/default_branch/documents:import" \
  "{\"gcsSource\":{\"inputUris\":[\"gs://${BUCKET}/policies/*\"],\"dataSchema\":\"content\"},\"reconciliationMode\":\"FULL\"}" | head -c 400; echo

cat <<DONE

Done. Indexing takes a few minutes. Then:
  1. Check it:   bash scripts/agent-search-setup.sh check     (a result should name policy-clause-5-4.txt)
  2. In .env.uat uncomment and set:
       AGENT_SEARCH_DATA_STORE=${DATA_STORE}
       AGENT_SEARCH_LOCATION=${LOCATION}
  3. Tell the coding agent it is ready (section 9.1), then redeploy:  bash scripts/deploy.sh uat
DONE
