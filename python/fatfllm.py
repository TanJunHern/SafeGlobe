"""
FATF LLM Extraction Script
Extracts FATF Greylist and Blacklist countries and saves to fatf_country_risks.json.
"""
from fatfllmcall import *

if __name__ == "__main__":
    greylist_url = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html"
    blacklist_url = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/call-for-action-june-2026.html"

    report = build_combined_fatf_report(greylist_url, blacklist_url)

    output_locations = [
        os.path.join(os.path.dirname(__file__), "fatf_country_risks.json"),
        os.path.join(os.path.dirname(__file__), "..", "fatf_country_risks.json")
    ]

    for out_path in output_locations:
        try:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(report.model_dump(), f, indent=2)
            print(f"[+] Saved structured risk data to: {out_path}")
        except Exception as err:
            print(f"[-] Could not write to {out_path}: {err}")

    print("\nResulting FATF Country Risks JSON:")
    print(json.dumps(report.model_dump(), indent=2))
