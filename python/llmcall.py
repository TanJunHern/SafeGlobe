import os
import json
import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel, Field
from typing import List
from google import genai
from google.genai import types
from dotenv import load_dotenv, find_dotenv

# Load environment variables from .env file (looks in current and parent directories)
load_dotenv(find_dotenv())

# ----------------------------------------------------
# 1. Define Output Schema
# ----------------------------------------------------
class CountryRiskReport(BaseModel):
    source_url: str
    effective_date: str = Field(description="Date or plenary session period of the statement, e.g., 'June 2026'")
    black_list: List[str] = Field(
        description="High-Risk Jurisdictions subject to a Call for Action (Black List)"
    )
    grey_list: List[str] = Field(
        description="Jurisdictions under Increased Monitoring (Grey List)"
    )
    removed_countries: List[str] = Field(
        default=[],
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
def parse_jurisdictions_from_url(url: str) -> CountryRiskReport:
    raw_content = fetch_clean_webpage_text(url)
    
    # Truncate or chunk if web page text exceeds model token window (usually not an issue for plenary pages)
    sample_text = raw_content[:40000]

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY not found in environment or .env file.\n"
            "Please create a .env file in the project root with:\n"
            "  GEMINI_API_KEY=your_key_here\n"
            "You can get a free key at: https://aistudio.google.com/app/apikey"
        )

    client = genai.Client(api_key=api_key)

    prompt = f"""
    You are an expert Anti-Money Laundering (AML) compliance analyst.
    Analyze the provided public release text and identify:
    1. Jurisdictions subject to a Call for Action / Black List (High Risk).
    2. Jurisdictions under Increased Monitoring / Grey List (Medium Risk).
    3. Any jurisdictions explicitly noted as de-listed or removed from monitoring.

    Standardize all country names to their official common English country names.
    Source URL: {url}

    Raw Content:
    {sample_text}
    """

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=CountryRiskReport,
            temperature=0.0,
        ),
    )

    # Validate output against the schema
    result = CountryRiskReport.model_validate_json(response.text)
    return result

# ----------------------------------------------------
# 4. Execution & File Output
# ----------------------------------------------------
if __name__ == "__main__":
    target_url = "https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html"
    
    report = parse_jurisdictions_from_url(target_url)

    # Save formatted JSON for downstream services (e.g., Firestore or map overlay engine)
    output_filename = "fatf_country_risks.json"
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2)

    print(f"Successfully generated structured risk data in {output_filename}:")
    print(json.dumps(report.model_dump(), indent=2))