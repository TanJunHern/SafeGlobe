#!/usr/bin/env bash
# DueDilly smoke test: read-only checks plus one sample screening against a running app.
#
#   bash scripts/smoke.sh http://localhost:8080
#   bash scripts/smoke.sh https://duedilly-uat-xxxx.asia-southeast1.run.app
set -uo pipefail
URL="${1:-http://localhost:8080}"
URL="${URL%/}"
fail=0
check() { # name, expected text, actual
  case "$3" in
    *"$2"*) printf '  ok    %s\n' "$1" ;;
    *) printf '  FAIL  %s\n        got: %s\n' "$1" "${3:0:200}"; fail=1 ;;
  esac
}
echo "Smoke test: $URL"
health="$(curl -s -m 20 "$URL/api/health")"
check "health" '"status":"healthy"' "$health"
echo "        $(printf '%s' "$health" | head -c 160)"
check "page loads" 'DueDilly' "$(curl -s -m 20 "$URL/")"
check "scoring rules" '"version"' "$(curl -s -m 20 "$URL/api/risk/rules")"
check "Aurora Venture breakdown" '"risk"' "$(curl -s -m 20 "$URL/api/risk/breakdown/aurora")"
check "sample screening (Meridian Port Logistics)" '"status":"screened"' "$(curl -s -m 30 -X POST "$URL/v1/screen" -H 'Content-Type: application/json' -d '{"entity":"organisation","name":"Meridian Port Logistics Pte Ltd","jurisdiction":"SGP"}')"
status="$(curl -s -m 20 "$URL/api/pond-guard/status")"
check "Pond-Guard status" '"mode"' "$status"
echo "        Pond-Guard: $(printf '%s' "$status" | sed -E 's/.*"mode":"([a-z]+)".*/\1/')"
check "internal tools are closed" '401' "$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/internal/ask-tools/alerts")"
[ "$fail" = 0 ] && echo "All checks passed." || echo "Some checks failed."
exit "$fail"
