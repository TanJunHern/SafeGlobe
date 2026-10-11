#!/usr/bin/env python3
"""Sends JSON to the DueDilly ongoing-monitoring API and prints what comes back.

Standard library only. Start the app first (npm start), then:

    python3 scripts/monitoring_api_test.py                      # read-only: sources, a cost estimate, the monitored list
    python3 scripts/monitoring_api_test.py --write              # also sets a source cost, saves defaults, runs due re-screens
    python3 scripts/monitoring_api_test.py --base http://localhost:8080 --frequency weekly

--write changes data in the database the server is using.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

COMPLIANCE = {"x-user-email": "compliance@duedilly.com", "x-user-role": "compliance_officer"}
EMPLOYEE = {"x-user-email": "john.doe@duedilly.com", "x-user-role": "employee"}


def call(base, method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read() or b"{}")


def show(title, status, payload):
    print(f"\n== {title} -> HTTP {status}")
    print(json.dumps(payload, indent=2)[:1800])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:8080")
    parser.add_argument("--frequency", default="monthly", choices=["daily", "weekly", "monthly", "yearly"])
    parser.add_argument("--cost", type=float, default=0.75, help="cost per screen (SGD) to set on the first source with --write")
    parser.add_argument("--write", action="store_true", help="also run the calls that change data")
    args = parser.parse_args()

    status, sources = call(args.base, "GET", "/api/sources")
    if status != 200:
        sys.exit(f"Could not reach {args.base} (HTTP {status}). Is the server running?")
    source_list = sources.get("sources", [])
    show("GET /api/sources", status, [{k: s.get(k) for k in ("id", "label", "type", "cost_per_screen")} for s in source_list])
    source_ids = [s["id"] for s in source_list[:2]]

    schedule = {"frequency": args.frequency, "start_date": "2026-01-05", "end_date": "2026-12-31", "source_ids": source_ids}
    show("POST /api/monitoring/estimate (as an employee)", *call(args.base, "POST", "/api/monitoring/estimate", schedule, EMPLOYEE))

    status, listing = call(args.base, "GET", "/api/monitoring", headers=COMPLIANCE)
    show("GET /api/monitoring (as compliance)", status, {"totals": listing.get("totals"), "defaults": listing.get("defaults"),
                                                        "items": [{"id": i["id"], "name": i["counterparty_name"], "frequency": i["schedule"]["frequency"],
                                                                   "next_run_date": i["next_run_date"], "due": i["due"], "per_year": i["cost"]["per_year"]}
                                                                  for i in listing.get("items", [])]})

    show("POST /api/ask/history", *call(args.base, "POST", "/api/ask/history", {"query": "How many screened are there?"}, COMPLIANCE))
    show("GET /api/stats", *call(args.base, "GET", "/api/stats"))

    # An employee must not be able to change a schedule
    show("PUT /api/monitoring/defaults as an employee (expect 403)", *call(args.base, "PUT", "/api/monitoring/defaults", {"frequency": "daily"}, EMPLOYEE))

    if not args.write:
        print("\nRead-only run finished. Add --write to set a cost, save defaults and run due re-screens.")
        return

    if source_ids:
        show(f"PUT /api/sources/{source_ids[0]}/cost", *call(args.base, "PUT", f"/api/sources/{source_ids[0]}/cost", {"cost_per_screen": args.cost}, COMPLIANCE))
    show("PUT /api/monitoring/defaults", *call(args.base, "PUT", "/api/monitoring/defaults", {"frequency": args.frequency, "source_ids": source_ids}, COMPLIANCE))
    show("POST /api/monitoring/run (what is due)", *call(args.base, "POST", "/api/monitoring/run", {}, COMPLIANCE))


if __name__ == "__main__":
    main()
