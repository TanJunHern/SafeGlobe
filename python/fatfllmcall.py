import os
import json
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from typing import List, Optional
from google import genai
from google.genai import types
from dotenv import load_dotenv, find_dotenv

# Load environment variables from .env file (looks in current and parent directories)
load_dotenv(find_dotenv())

# ----------------------------------------------------
# 1. Define Output Schema
# ----------------------------------------------------
class CountryRiskReport(BaseModel):
    source_url: Optional[str] = None
    source_urls: List[str] = Field(default_factory=list, description="Source URLs processed")
    effective_date: str = Field(default="June 2026", description="Date or plenary session period of the statement, e.g., 'June 2026'")
    black_list: List[str] = Field(
        default_factory=list,
        description="High-Risk Jurisdictions subject to a Call for Action (Black List)"
    )
    grey_list: List[str] = Field(
        default_factory=list,
        description="Jurisdictions under Increased Monitoring (Grey List)"
    )
    removed_countries: List[str] = Field(
        default_factory=list,
        description="Countries explicitly stated as no longer subject to increased monitoring"
    )

# ----------------------------------------------------
# 2. Extract Cleaned Web Content
# ----------------------------------------------------
def fetch_clean_webpage_text(url: str) -> str:
    try:
        from curl_cffi import requests as cffi_requests
        response = cffi_requests.get(url, impersonate="chrome124", timeout=20)
    except ImportError:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=20)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove non-content elements
    for element in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        element.extract()

    # Extract text and collapse excessive whitespace
    text = soup.get_text(separator="\n")
    cleaned_lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(cleaned_lines)

# ----------------------------------------------------
# 3. LLM Structured Extraction
# ----------------------------------------------------
def parse_jurisdictions_from_url(url: str, list_type: str = "both") -> CountryRiskReport:
    raw_content = fetch_clean_webpage_text(url)
    sample_text = raw_content[:40000]

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY or GOOGLE_API_KEY not found in environment or .env file.\n"
            "Please create a .env file with your key: https://aistudio.google.com/app/apikey"
        )

    client = genai.Client(api_key=api_key)

    if list_type == "blacklist":
        task_instruction = """
        This publication is the FATF "High-Risk Jurisdictions subject to a Call for Action" (Black List).
        Extract all countries/jurisdictions that are on this Call for Action / Black List (High Risk).
        Leave grey_list empty unless specified.
        """
    elif list_type == "greylist":
        task_instruction = """
        This publication is the FATF "Jurisdictions under Increased Monitoring" (Grey List).
        Extract all countries/jurisdictions under increased monitoring (Grey List).
        Also extract any jurisdictions explicitly noted as de-listed or removed from monitoring.
        Leave black_list empty unless specified.
        """
    else:
        task_instruction = """
        Identify:
        1. Jurisdictions subject to a Call for Action / Black List (High Risk).
        2. Jurisdictions under Increased Monitoring / Grey List (Medium Risk).
        3. Any jurisdictions explicitly noted as de-listed or removed from monitoring.
        """

    prompt = f"""
    You are an expert Anti-Money Laundering (AML) compliance analyst.
    {task_instruction}

    Standardize all country names to their official common English country names (e.g. "North Korea" or "Democratic People's Republic of Korea", "Iran", "Myanmar", "Vietnam", "Syria").
    Source URL: {url}

    Raw Content:
    {sample_text}
    """

    candidate_models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"]
    last_err = None

    for model_name in candidate_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=CountryRiskReport,
                    temperature=0.0,
                ),
            )
            result = CountryRiskReport.model_validate_json(response.text)
            result.source_url = url
            return result
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(f"All candidate models failed. Last error: {last_err}")

# ----------------------------------------------------
# 4. Multi-Source Pipeline (Blacklist + Greylist)
# ----------------------------------------------------
def build_combined_fatf_report(
    greylist_url: str = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html",
    blacklist_url: str = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/call-for-action-june-2026.html"
) -> CountryRiskReport:
    print(f"[*] Processing FATF Grey List URL: {greylist_url}")
    grey_report = parse_jurisdictions_from_url(greylist_url, list_type="greylist")

    print(f"[*] Processing FATF Black List (Call for Action) URL: {blacklist_url}")
    black_report = parse_jurisdictions_from_url(blacklist_url, list_type="blacklist")

    # Combine and de-duplicate
    black_set = set(black_report.black_list)
    # Ensure any blacklisted countries are not also counted as grey
    grey_list = [c for c in grey_report.grey_list if c not in black_set]
    black_list = sorted(list(black_set))
    removed_list = sorted(list(set(grey_report.removed_countries)))

    combined = CountryRiskReport(
        source_url=blacklist_url,
        source_urls=[greylist_url, blacklist_url],
        effective_date=black_report.effective_date or grey_report.effective_date or "June 2026",
        black_list=black_list,
        grey_list=grey_list,
        removed_countries=removed_list
    )
    return combined

# ----------------------------------------------------
# 5. Execution & File Output
# ----------------------------------------------------
if __name__ == "__main__":
    greylist_url = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html"
    blacklist_url = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/call-for-action-june-2026.html"

    report = build_combined_fatf_report(greylist_url, blacklist_url)

    # Save to python/fatf_country_risks.json and project root fatf_country_risks.json
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