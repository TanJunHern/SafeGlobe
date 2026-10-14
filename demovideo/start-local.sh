#!/usr/bin/env bash
# Starts the local app (port 8080) and the local ADK agents (port 8090) for recording the demo.
# Gemini on Vertex AI, Agent Search and the agents are live (your gcloud sign-in). BigQuery ML is not called:
# the review model is trained inside the app, and record.js replays the real BigQuery ML run of 12 Oct on screen.
#   bash demovideo/start-local.sh        start (a fresh demo database each time)
#   bash demovideo/start-local.sh stop   stop
set -uo pipefail
cd "$(dirname "$0")/.."
pkill -f "uvicorn app.main:app" 2>/dev/null; pkill -f "node src/server.js" 2>/dev/null
[ "${1:-}" = "stop" ] && { echo "stopped"; exit 0; }
sleep 1
mkdir -p demovideo/.data && rm -rf demovideo/.data/*
(APP_ENV=uat nohup bash scripts/agents-dev.sh > demovideo/.data/agents.log 2>&1 &)
(APP_ENV=uat PORT=8080 DATABASE_PATH=demovideo/.data/demo.db BIGQUERY=local PUBSUB_MODE=inline DOCUMENT_STORAGE=local \
  AI_RATE_LIMIT_MAX=0 VESSELFINDER_LOOKUP=off nohup node src/server.js > demovideo/.data/app.log 2>&1 &)
for i in $(seq 1 40); do curl -s -m 2 localhost:8090/health >/dev/null && curl -s -m 2 localhost:8080/api/health >/dev/null && break; sleep 1; done
curl -s localhost:8080/api/health; echo; curl -s localhost:8090/health; echo
